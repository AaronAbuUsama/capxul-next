// The bench host's first boot: the data disk under Docker, formatted only when empty, and Docker on loopback only.
import assert from "node:assert/strict";
import { test } from "node:test";
import { userData, volumeDevice } from "../src/user-data.ts";

const script = userData("vol-0123456789abcdef0");

test("the data volume is found by its id, formatted only if it has no filesystem, and mounted under Docker", () => {
  assert.equal(
    volumeDevice("vol-0123456789abcdef0"),
    "/dev/disk/by-id/nvme-Amazon_Elastic_Block_Store_vol0123456789abcdef0",
  );
  assert.match(script, /blkid "\$DEV" \|\| mkfs\.xfs -L capxul-data "\$DEV"/);
  assert.match(script, /LABEL=capxul-data \/var\/lib\/docker xfs defaults,nofail/);
  assert.match(script, /mount \/var\/lib\/docker\n(.*\n)*dnf install -y docker/);
});

test("Docker listens on its socket and on the machine's loopback, never on another address", () => {
  assert.match(script, /-H unix:\/\/\/var\/run\/docker\.sock -H tcp:\/\/127\.0\.0\.1:2375 /);
  assert.doesNotMatch(script, /tcp:\/\/0\.0\.0\.0/);
  assert.match(script, /^#!\/bin\/bash\n/);
});
