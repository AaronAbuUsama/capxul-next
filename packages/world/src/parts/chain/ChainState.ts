// Where a stopped chain's state is kept: one object per chain. forceDestroy lets the world's destroy empty it.
import * as Cloudflare from "@alchemy.run/cloudflare";

export const ChainState = Cloudflare.R2.Bucket("ChainState", { forceDestroy: true });
