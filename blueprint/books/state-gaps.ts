import { defineDecision } from "../../packages/blueprint-engine/src/index.ts";
import * as d from "./data.ts";
export const decision_books_state_gaps = defineDecision({
  id: "books.cut-state-gaps", title: "The cut review commands do not drive the annotation machine",
  question: "Why do the review transitions have no driver?",
  options: [{ label: "retain", text: [
    "undriven-transition: book-annotation.accept stands for the cut review --accept surface. The active annotation save already uses assign or recategorize; it must not invent a second accept event. book-annotation.reclassify stands for the cut bulk command and its single rows_reclassified fact, not an ordinary annotation save."
  ].join("\n") }],
  chosen: "retain", why: "cut.books reaches chart management through ERPNext and the document door, not the cut native commands. cut.principle keeps supporting records; remaining money-fact writers still use books data. The chart itself is ERPNext's on the site (books.chart-owner).",
  source: "Builder, m1-gaps-states; lane findings.json; cut.books; books/data.ts and annotations.ts",
  stands: [
  {
    "record": "transition:book-annotation.accept",
    "rule": "undriven-transition",
    "why": "cut.books reaches chart management through ERPNext and the document door, not the cut native commands. cut.principle keeps supporting records; remaining money-fact writers still use books data. The chart itself is ERPNext's on the site (books.chart-owner)."
  },
  {
    "record": "transition:book-annotation.reclassify",
    "rule": "undriven-transition",
    "why": "cut.books reaches chart management through ERPNext and the document door, not the cut native commands. cut.principle keeps supporting records; remaining money-fact writers still use books data. The chart itself is ERPNext's on the site (books.chart-owner)."
  }
],
  affects: [d.machine_book_annotation.t.accept, d.machine_book_annotation.t.reclassify],
});
