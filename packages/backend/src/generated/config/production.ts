// Generated from blueprint by packages/generate. Do not edit. sha256:027d432f5a1640baec7257cf8aba93349b60c29f4e3acbc06d400b48b2a4a947
import { Config } from "effect";

export const ProductionConfig = Config.all({
  CAPXUL_ENV: Config.NonEmptyString("CAPXUL_ENV"),
  SITE_URL: Config.NonEmptyString("SITE_URL"),
});
