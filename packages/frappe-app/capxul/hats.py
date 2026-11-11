"""hat_granted / hat_revoked -> Frappe User, Has Role, User Permission."""
import json

import frappe

from capxul.locks import applying


def hat_roles(hat):
    if not frappe.db.exists("Capxul Hat Map", hat):
        frappe.throw(f"Unknown hat {hat!r}: no row in Capxul Hat Map", frappe.ValidationError)
    return [r.role for r in frappe.get_doc("Capxul Hat Map", hat).roles if frappe.db.exists("Role", r.role)]


def ensure_department(name):
    if frappe.db.exists("Department", name):
        return name
    hit = frappe.db.get_value("Department", {"department_name": name})
    if hit:
        return hit
    company = frappe.db.get_single_value("Global Defaults", "default_company") or frappe.db.get_value("Company", {})
    d = frappe.get_doc({"doctype": "Department", "department_name": name, "company": company, "parent_department": "All Departments"})
    d.insert(ignore_permissions=True)
    return d.name


def ensure_employee(email, full_name, dept):
    """ERPNext's own User hook (erpnext.setup.doctype.employee.employee.validate_employee_role) strips the `Employee`
    role from any User with no Employee record. So the `member` hat has to create the Employee first. The date of
    birth and gender are placeholders: the chain does not know them (a finding, see FINDINGS.md). `create_user_permission` is 0: ERPNext's default (1) restricts the person to their own Employee record, which would stop an HR hat from working with any other employee."""
    if frappe.db.exists("Employee", {"user_id": email}):
        return
    first, _, last = (full_name or email).partition(" ")
    emp = frappe.get_doc(
        {"doctype": "Employee", "first_name": first, "last_name": last, "user_id": email, "company_email": email,
         "company": frappe.db.get_single_value("Global Defaults", "default_company"), "gender": "Prefer not to say",
         "date_of_birth": "1990-01-01", "create_user_permission": 0, "date_of_joining": frappe.utils.nowdate(), "status": "Active",
         "department": ensure_department(dept) if dept else None}
    )
    emp.flags.ignore_permissions = True
    emp.insert()


def ensure_user(email, full_name, roles):
    if frappe.db.exists("User", email):
        user = frappe.get_doc("User", email)
        have = {r.role for r in user.roles}
        add = [r for r in roles if r not in have]
        if add:
            user.add_roles(*add)
        return user
    first, _, last = (full_name or email).partition(" ")
    user = frappe.get_doc(
        {
            "doctype": "User", "email": email, "first_name": first, "last_name": last, "enabled": 1,
            "send_welcome_email": 0, "user_type": "System User",
            "roles": [{"role": r} for r in roles],
        }
    )
    user.flags.ignore_permissions = True
    user.insert()
    return user


def apply_hat_granted(data, event_key=None):
    if not data.get("person_email"):  # the chain names a person only by address; Core had no email for it
        frappe.throw(f"hat_granted for address {data.get('address')} has no person_email: nobody to make a User for", frappe.ValidationError)
    hat, email = data["hat"], data["person_email"].strip().lower()
    dept = data.get("department") or ""
    roles = hat_roles(hat)
    with applying():
        ensure_user(email, data.get("person_name"), roles)  # ERPNext strips `Employee` here (no Employee record yet)
        if "Employee" in roles:
            ensure_employee(email, data.get("person_name"), dept)
            ensure_user(email, data.get("person_name"), roles)  # now it sticks
        if not frappe.db.exists("Capxul Hat Grant", {"user": email, "hat": hat, "department": dept}):
            frappe.get_doc(
                {"doctype": "Capxul Hat Grant", "user": email, "hat": hat, "department": dept,
                 "roles_given": json.dumps(roles), "event_key": event_key}
            ).insert(ignore_permissions=True)
        if dept:
            from frappe.permissions import add_user_permission

            add_user_permission("Department", ensure_department(dept), email, ignore_permissions=True)


def apply_hat_revoked(data, event_key=None):
    if not data.get("person_email"):
        frappe.throw(f"hat_revoked for address {data.get('address')} has no person_email", frappe.ValidationError)
    hat, email = data["hat"], data["person_email"].strip().lower()
    dept = data.get("department") or ""
    grants = frappe.get_all("Capxul Hat Grant", {"user": email, "hat": hat, "department": dept}, ["name", "roles_given"])
    if not grants:
        return
    gave = set()
    for g in grants:
        gave |= set(json.loads(g.roles_given or "[]"))
        frappe.delete_doc("Capxul Hat Grant", g.name, ignore_permissions=True, force=True)
    remaining = frappe.get_all("Capxul Hat Grant", {"user": email}, ["roles_given", "department"])
    keep = set()
    for g in remaining:
        keep |= set(json.loads(g.roles_given or "[]"))
    with applying():
        drop = gave - keep
        if drop and frappe.db.exists("User", email):
            frappe.get_doc("User", email).remove_roles(*drop)
        if dept and not any(g.department == dept for g in remaining):
            dname = frappe.db.get_value("Department", {"department_name": dept}) or dept
            for up in frappe.get_all("User Permission", {"user": email, "allow": "Department", "for_value": dname}):
                frappe.delete_doc("User Permission", up.name, ignore_permissions=True, force=True)
