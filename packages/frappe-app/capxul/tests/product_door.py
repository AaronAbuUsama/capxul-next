"""Native disposable-site regression: bench --site SITE execute capxul.tests.product_door.run.

This is component evidence, not a selected-world verdict. Setup grants hats through the real app;
all documents under test are made through product_door, never testutil or Administrator insertion.
"""
import hashlib
import uuid

import frappe

from capxul import hats, payments, product_door


def run():
    prefix = "door-" + uuid.uuid4().hex[:10]
    org = frappe.db.get_single_value("Capxul Settings", "org_slug")
    company = frappe.db.get_single_value("Global Defaults", "default_company")
    director, peer, member = [f"{prefix}-{role}@example.invalid" for role in ("director", "peer", "member")]
    frappe.set_user("Administrator")
    for user, hat in ((director, "admin"), (director, "member"), (peer, "admin"), (member, "member")):
        hats.apply_hat_granted({"hat": hat, "person_email": user, "person_name": "Door Test"})
    frappe.db.commit()
    passed = []

    def call(verb, doctype, **kwargs):
        frappe.local.response = frappe._dict()
        return product_door.run(org, verb, doctype, **kwargs)

    def success(result):
        assert result["ok"], result
        return result["data"]

    def error(result, code):
        assert result == {"ok": False, "error": {"code": code, "message": result["error"]["message"]}}, result

    frappe.set_user(director)
    parent = frappe.get_all("Account", {"company": company, "is_group": 1, "root_type": "Expense"}, pluck="name")[0]
    number = "8" + str(uuid.uuid4().int)[:12]
    ledger = success(call("create", "Account", fields={"account_name": prefix, "account_number": number,
                         "parent_account": parent, "company": company, "is_group": 0}, call_id=prefix + "-account"))
    by_number = success(product_door.account(org, number))
    by_name = success(product_door.account(org, ledger["name"]))
    assert by_number == by_name and by_number["name"] == ledger["name"]
    assert by_number["fields"]["account_number"] == number and by_number["fields"]["company"] == company
    assert not by_number["fields"]["is_group"] and not by_number["fields"]["disabled"]
    error(product_door.account(org, prefix + "-missing"), "INVALID_INPUT")
    error(product_door.account(org, parent), "INVALID_INPUT")
    frappe.db.set_value("Account", ledger["name"], "disabled", 1)
    error(product_door.account(org, number), "INVALID_INPUT")
    frappe.db.set_value("Account", ledger["name"], "disabled", 0)
    frappe.set_user(member)
    error(product_door.account(org, number), "ROLE_PERMISSION_DENIED")
    frappe.set_user(director)
    passed.append("account number and canonical name resolve only enabled visible ledger accounts of the native Company")

    args = dict(fields={"supplier_name": prefix, "supplier_group": "All Supplier Groups"}, call_id=prefix + "-supplier")
    supplier = success(call("create", "Supplier", **args))
    assert supplier["docstatus"] == 0 and supplier["fields"]["supplier_name"] == prefix
    frappe.db.commit()  # A lost HTTP response happens after this commit, before a later call.
    retry = success(call("create", "Supplier", fields=dict(reversed(list(args["fields"].items()))), call_id=args["call_id"]))
    assert supplier == retry
    assert frappe.db.count("Supplier", {"supplier_name": prefix}) == 1
    passed.append("committed create retries once with canonical payload")
    error(call("create", "Supplier", fields={"supplier_name": "changed"}, call_id=args["call_id"]), "INVALID_INPUT")
    frappe.set_user(peer)
    error(call("create", "Supplier", **args), "ROLE_PERMISSION_DENIED")
    frappe.set_user(member)
    error(call("create", "Supplier", fields={"supplier_name": prefix + "-denied"}, call_id=prefix + "-member"), "ROLE_PERMISSION_DENIED")
    assert not frappe.db.exists("Supplier", {"supplier_name": prefix + "-denied"})
    passed.append("changed payload, changed person and unauthorized member refuse")

    frappe.set_user(director)
    for fields in ({"supplier_name": prefix + "-bad", "supplier_group": prefix + "-missing"},
                   {"supplier_name": prefix + "-bad", "flags": {"ignore_permissions": True}},
                   {"supplier_name": prefix + "-bad", "docstatus": 1}):
        call_id = prefix + "-invalid"
        error(call("create", "Supplier", fields=fields, call_id=call_id), "INVALID_INPUT")
        assert not frappe.db.exists("Supplier", {"supplier_name": prefix + "-bad"})
        assert not frappe.db.exists("Capxul Door Call", hashlib.sha256(call_id.encode()).hexdigest())
    passed.append("invalid links and permission/control-field injection roll back receipt and document")

    duplicate = prefix + "-duplicate"  # A new call id for an existing name: Frappe raises DuplicateEntryError.
    error(call("create", "Supplier", fields={"supplier_name": prefix, "supplier_group": "All Supplier Groups"}, call_id=duplicate), "INVALID_INPUT")
    assert frappe.local.response.http_status_code == 400
    assert frappe.db.count("Supplier", {"supplier_name": prefix}) == 1
    assert not frappe.db.exists("Capxul Door Call", hashlib.sha256(duplicate.encode()).hexdigest())
    passed.append("a duplicate create refuses as caller input, not a retryable provider error")

    item = success(call("create", "Item", fields={"item_code": prefix, "item_name": prefix,
                        "item_group": "All Item Groups", "is_stock_item": 0, "stock_uom": "Nos"}, call_id=prefix + "-item"))
    invoice = success(call("create", "Purchase Invoice", fields={"supplier": supplier["name"], "company": company,
                           "items": [{"item_code": item["name"], "qty": 1, "rate": 37.25}]}, call_id=prefix + "-invoice"))
    posted = success(call("submit", "Purchase Invoice", name=invoice["name"], call_id=prefix + "-post"))
    assert posted["docstatus"] == 1
    # Frappe's first Python result can contain date objects; the HTTP contract is their JSON representation.
    assert frappe.as_json(success(call("submit", "Purchase Invoice", name=invoice["name"], call_id=prefix + "-post"))) == frappe.as_json(posted)
    error(call("submit", "Purchase Invoice", name=invoice["name"], call_id=prefix + "-other-post"), "WRONG_STATE")
    gl = frappe.get_all("GL Entry", {"voucher_no": invoice["name"], "is_cancelled": 0}, ["name", "debit", "credit"])
    assert gl and sum(row.debit for row in gl) == 37.25 and sum(row.credit for row in gl) == 37.25
    passed.append("ordinary submit posts balanced GL once and rejects a new second submit")

    from erpnext.accounts.doctype.payment_entry.payment_entry import get_payment_entry
    safe = frappe.db.get_single_value("Capxul Settings", "safe_account")
    # The native mapper only prepares fields; product_door is still the only insertion/submit path.
    mapped = get_payment_entry("Purchase Invoice", invoice["name"], bank_account=safe)
    fields = {key: mapped.get(key) for key in ("payment_type", "party_type", "party", "company", "paid_from", "paid_to",
              "paid_amount", "received_amount", "source_exchange_rate", "target_exchange_rate")}
    fields["references"] = [{"reference_doctype": "Purchase Invoice", "reference_name": invoice["name"], "allocated_amount": 37.25}]
    # A supplier's wallet is a native document field, not a Core approval identity.
    frappe.db.set_value("Supplier", supplier["name"], "capxul_wallet_address", "0x" + "7" * 40)
    payment = success(call("create", "Payment Entry", fields=fields, call_id=prefix + "-payment"))
    held = success(call("submit", "Payment Entry", name=payment["name"], call_id=prefix + "-hold"))
    assert held["safe"] and held["status"] == "Requesting" and held["request"] and held["approval_url"] is None
    assert success(call("submit", "Payment Entry", name=payment["name"], call_id=prefix + "-hold")) == held
    payments.answer_request({"request_id": held["request"], "approval_id": prefix + "-approval",
                             "approval_url": "http://core.invalid/approve/component", "requested_by": director,
                             "awaiting": "0x" + "8" * 40})
    assert success(call("submit", "Payment Entry", name=payment["name"], call_id=prefix + "-later-hold")) == held
    assert frappe.db.get_value("Payment Entry", payment["name"], "docstatus") == 0
    assert not frappe.db.exists("GL Entry", {"voucher_no": payment["name"]})
    passed.append("Safe submit returns stable asynchronous request, no approval invented or GL posted")

    frappe.local.response = frappe._dict()
    report = success(product_door.report(org, "General Ledger", {"company": company,
                     "from_date": frappe.utils.nowdate(), "to_date": frappe.utils.nowdate(), "voucher_no": invoice["name"]}))
    assert report["columns"] and report["rows"] and all(isinstance(row, dict) for row in report["rows"])
    assert any(row.get("voucher_no") == invoice["name"] for row in report["rows"])
    assert gl == frappe.get_all("GL Entry", {"voucher_no": invoice["name"], "is_cancelled": 0}, ["name", "debit", "credit"])
    passed.append("native report returns the actual voucher and changes no GL")
    frappe.db.commit()

    frappe.set_user("Administrator")
    hats.apply_hat_revoked({"hat": "admin", "person_email": director})
    frappe.set_user(director)
    error(call("create", "Supplier", **args), "ROLE_PERMISSION_DENIED")
    assert frappe.db.count("Supplier", {"supplier_name": prefix}) == 1
    passed.append("saved document response cannot bypass current permissions after revocation")
    frappe.db.commit()
    return {"passed": passed, "supplier": supplier["name"], "invoice": invoice["name"], "payment": payment["name"]}


def field_permissions():
    """Real native field/receipt regression on a disposable site, not selected-world evidence."""
    prefix = "Door Fields " + uuid.uuid4().hex[:10]
    parent, child, report = prefix, prefix + " Row", prefix + " Report"
    user = prefix.replace(" ", "-").lower() + "@example.invalid"
    org = frappe.db.get_single_value("Capxul Settings", "org_slug")
    call_ids = [prefix + suffix for suffix in ("-create", "-submit", "-limited-create", "-limited-submit")]
    keys = [hashlib.sha256(call_id.encode()).hexdigest() for call_id in call_ids]
    checks = {}

    def call(verb, **kwargs):
        frappe.local.response = frappe._dict()
        answer = product_door.run(org, verb, parent, **kwargs)
        assert answer["ok"], answer
        return answer["data"]

    def filtered(result, visible):
        fields = result["fields"]
        row = fields["rows"][0]
        return (fields["visible"] == visible and fields.get("restricted") is None
                and not fields.get("restricted_rows")
                and fields["masked"] == fields["masked_number"] == "XXXXXXXX"
                and row["visible"] == "child-visible" and row.get("restricted") is None
                and row["masked"] == row["masked_number"] == "XXXXXXXX")

    try:
        frappe.set_user("Administrator")
        # Test-only metadata supplies native permlevels/masking; no permission method is mocked.
        common = [
            {"fieldname": "visible", "label": "Visible", "fieldtype": "Data"},
            {"fieldname": "restricted", "label": "Restricted", "fieldtype": "Data", "permlevel": 1,
             "default": "restricted-default"},
            {"fieldname": "masked", "label": "Masked", "fieldtype": "Data", "mask": 1},
            {"fieldname": "masked_number", "label": "Masked Number", "fieldtype": "Currency", "mask": 1},
        ]
        frappe.get_doc({"doctype": "DocType", "name": child, "module": "Capxul", "custom": 1,
                        "istable": 1, "fields": common}).insert()
        frappe.get_doc({"doctype": "DocType", "name": parent, "module": "Capxul", "custom": 1,
                        "is_submittable": 1, "fields": common + [
                            {"fieldname": "rows", "label": "Rows", "fieldtype": "Table", "options": child},
                            {"fieldname": "restricted_rows", "label": "Restricted Rows", "fieldtype": "Table",
                             "options": child, "permlevel": 1},
                        ], "permissions": [
                            {"role": "Sales User", "permlevel": 0, "read": 1, "write": 1, "create": 1, "submit": 1,
                             "report": 1},
                            {"role": "Accounts Manager", "permlevel": 0, "read": 1, "write": 1,
                             "create": 1, "submit": 1, "report": 1, "mask": 1},
                            {"role": "Accounts Manager", "permlevel": 1, "read": 1, "write": 1, "mask": 1},
                        ]}).insert()
        # Native report masking reads the same per-user cache; no permlevel-1 column is selected.
        frappe.get_doc({"doctype": "Report", "report_name": report, "ref_doctype": parent, "report_type": "Query Report",
                        "is_standard": "No", "module": "Capxul", "roles": [{"role": "Sales User"}, {"role": "Accounts Manager"}],
                        "query": f"select name, visible, masked, masked_number from `tab{parent}`"}).insert()
        for hat in ("admin", "sales"):
            hats.apply_hat_granted({"hat": hat, "person_email": user, "person_name": "Field Probe"})
        frappe.db.commit()
        frappe.set_user(user)
        row = {"visible": "child-visible", "restricted": "child-secret", "masked": "child-mask", "masked_number": 73.25}
        fields = {"visible": "before", "restricted": "parent-secret", "masked": "parent-mask",
                  "masked_number": 19.75, "rows": [row], "restricted_rows": [row]}
        created = call("create", fields=fields, call_id=call_ids[0])
        posted = call("submit", name=created["name"], call_id=call_ids[1])
        checks["authorized parent/child fields and masks remain readable"] = (
            created["fields"]["restricted"] == posted["fields"]["restricted"] == "parent-secret"
            and posted["fields"]["masked"] == "parent-mask" and posted["fields"]["masked_number"] == 19.75
            and posted["fields"]["rows"][0]["restricted"] == "child-secret"
            and posted["fields"]["restricted_rows"][0]["masked_number"] == 73.25)
        frappe.db.commit()  # Replay must survive an actual committed lost response.

        def report_row():
            frappe.local.response = frappe._dict()
            answer = product_door.report(org, report)
            assert answer["ok"], answer
            return answer["data"]["rows"][0]
        authorized_row = report_row()  # Also caches this user's admin-era masks for the report's DocType.
        checks["authorized report rows show unmasked values"] = (
            authorized_row["masked"] == "parent-mask" and authorized_row["masked_number"] == 19.75)
        receipts = frappe.db.get_all("Capxul Door Call", filters={"name": ["in", keys[:2]]},
                                     fields=["name", "response_json"], order_by="name")
        frappe.set_user("Administrator")
        # Change live state independently: replay must retain historical values, not refetch them.
        frappe.db.set_value(parent, created["name"], "visible", "after")
        hats.apply_hat_revoked({"hat": "admin", "person_email": user})
        frappe.db.commit()
        frappe.set_user(user)
        revoked_row = report_row()  # First call after revocation: nothing else has refreshed the cache yet.
        checks["report masks rows with current permissions after revocation"] = (
            revoked_row["visible"] == "after" and revoked_row["masked"] == revoked_row["masked_number"] == "XXXXXXXX")
        fresh = call("get", name=created["name"])
        create_replay = call("create", fields=fields, call_id=call_ids[0])
        submit_replay = call("submit", name=created["name"], call_id=call_ids[1])
        checks["get filters parent, child, whole-table and numeric masked values after revocation"] = filtered(fresh, "after")
        checks["create replay filters historical values with current permissions"] = filtered(create_replay, "before")
        checks["submit replay filters historical values with current permissions"] = filtered(submit_replay, "before")
        checks["replays preserve original draft/submitted status"] = create_replay["docstatus"] == 0 and submit_replay["docstatus"] == 1
        checks["replays neither rewrite private receipts nor repeat effects"] = (
            receipts == frappe.db.get_all("Capxul Door Call", filters={"name": ["in", keys[:2]]},
                                          fields=["name", "response_json"], order_by="name")
            and frappe.db.count(parent) == 1 and frappe.db.get_value(parent, created["name"], "visible") == "after")
        limited_fields = {"visible": "limited", "masked": "limited-mask", "masked_number": 12.5,
                          "rows": [{"visible": "child-visible", "masked": "child-mask", "masked_number": 24.75}]}
        limited = call("create", fields=limited_fields, call_id=call_ids[2])
        checks["fresh create filters restricted defaults and masks"] = filtered(limited, "limited")
        checks["fresh submit filters restricted defaults and masks"] = filtered(
            call("submit", name=limited["name"], call_id=call_ids[3]), "limited")
        assert all(checks.values()), {"failed": [name for name, passed in checks.items() if not passed]}
        return {"passed": list(checks)}
    finally:
        frappe.db.rollback()
        frappe.set_user("Administrator")
        for doctype in (parent, child):
            if frappe.db.exists("DocType", doctype):
                frappe.db.delete(doctype)
        frappe.db.delete("Capxul Door Call", {"name": ["in", keys]})
        if frappe.db.exists("Report", report):
            frappe.delete_doc("Report", report, force=True, ignore_permissions=True)
        for hat in ("admin", "sales"):
            hats.apply_hat_revoked({"hat": hat, "person_email": user})
        if frappe.db.exists("User", user):
            frappe.delete_doc("User", user, force=True, ignore_permissions=True)
        for doctype in (parent, child):
            if frappe.db.exists("DocType", doctype):
                frappe.delete_doc("DocType", doctype, force=True)
                frappe.db.sql_ddl(f"DROP TABLE IF EXISTS `tab{doctype}`")
        frappe.db.commit()
