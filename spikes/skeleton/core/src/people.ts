// Test people (stand-in for passkey holders), read from core/people.json.
import { readFileSync } from "node:fs";
import { config } from "./config.ts";

export type Person = { email: string; name: string; account: number; address: string; privateKey: `0x${string}` };
type File = { operator: Omit<Person, "email" | "name">; people: Person[] };

const file = JSON.parse(readFileSync(config.peopleFile, "utf8")) as File;
export const people: Person[] = file.people;
export const operatorKey = file.operator.privateKey;

export const byEmail = (email: string): Person | undefined =>
  people.find((p) => p.email.toLowerCase() === email.trim().toLowerCase());
export const byAddress = (address: string): Person | undefined =>
  people.find((p) => p.address.toLowerCase() === address.toLowerCase());
