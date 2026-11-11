import { defineDecision } from "../../packages/blueprint-engine/src/index.ts";
import * as d from "./data.ts";
export const decision_books_state_gaps = defineDecision({
  id: "books.cut-state-gaps", title: "Frappe chart changes do not drive the old native chart machines",
  question: "Why do the chart and review transitions have no driver?",
  options: [{ label: "retain", text: [
    "undriven-transition: book-account.rename and book-account.archive stand for the cut native rename and archive operations. Changing or disabling an ERPNext Account through doc is not a Core chart projection write.",
    "undriven-transition: book-annotation.accept stands for the cut review --accept surface. The active annotation save already uses assign or recategorize; it must not invent a second accept event. book-annotation.reclassify stands for the cut bulk command and its single rows_reclassified fact, not an ordinary annotation save.",
    "undriven-transition: book-company.import stands for cut native chart import. ERPNext owns import through the door; linking doc calls to this machine would falsely promise a native chart sync not specified in the current book."
  ].join("\n") }],
  chosen: "retain", why: "cut.books reaches chart management through ERPNext and the document door, not the cut native commands. cut.principle keeps supporting records; remaining money-fact writers still use books data. These gaps explicitly do not claim an implemented chart projection.",
  source: "Builder, m1-gaps-states; lane findings.json; cut.books; books/data.ts and annotations.ts",
  stands: [
  {
    "record": "transition:book-account.rename",
    "rule": "undriven-transition",
    "why": "cut.books reaches chart management through ERPNext and the document door, not the cut native commands. cut.principle keeps supporting records; remaining money-fact writers still use books data. These gaps explicitly do not claim an implemented chart projection."
  },
  {
    "record": "transition:book-account.archive",
    "rule": "undriven-transition",
    "why": "cut.books reaches chart management through ERPNext and the document door, not the cut native commands. cut.principle keeps supporting records; remaining money-fact writers still use books data. These gaps explicitly do not claim an implemented chart projection."
  },
  {
    "record": "transition:book-annotation.accept",
    "rule": "undriven-transition",
    "why": "cut.books reaches chart management through ERPNext and the document door, not the cut native commands. cut.principle keeps supporting records; remaining money-fact writers still use books data. These gaps explicitly do not claim an implemented chart projection."
  },
  {
    "record": "transition:book-annotation.reclassify",
    "rule": "undriven-transition",
    "why": "cut.books reaches chart management through ERPNext and the document door, not the cut native commands. cut.principle keeps supporting records; remaining money-fact writers still use books data. These gaps explicitly do not claim an implemented chart projection."
  },
  {
    "record": "transition:book-company.import",
    "rule": "undriven-transition",
    "why": "cut.books reaches chart management through ERPNext and the document door, not the cut native commands. cut.principle keeps supporting records; remaining money-fact writers still use books data. These gaps explicitly do not claim an implemented chart projection."
  }
],
  affects: [d.machine_book_account.t.rename, d.machine_book_account.t.archive, d.machine_book_annotation.t.accept, d.machine_book_annotation.t.reclassify, d.machine_book_company.t.import],
});
