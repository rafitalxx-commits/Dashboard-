import assert from "node:assert/strict";
import { getCurrentUserPhotoId } from "../src/modules/communications/currentUserAvatar.ts";

const people = [
  { id: "another-user", photoId: "photo-other" },
  { id: "rafa-user", photoId: "photo-rafa" },
];

assert.equal(getCurrentUserPhotoId(people, "rafa-user"), "photo-rafa");
assert.equal(getCurrentUserPhotoId(people, "missing-user"), null);
assert.equal(
  getCurrentUserPhotoId([{ id: "rafa-user", photoId: null }], "rafa-user"),
  null,
);
assert.equal(getCurrentUserPhotoId(people, ""), null);

console.log("Current-user profile photo selection OK");
