import assert from "node:assert/strict";
import test from "node:test";

import { buildCommitUrl, createGitCommitInfo } from "../src/gitCommitInfo.js";

test("buildCommitUrl creates GitHub commit links from supported remote URLs", () => {
  const hash = "1234567890abcdef";

  assert.equal(
    buildCommitUrl("https://github.com/Hantu-Raya/3d-hud-web-merger.git", hash),
    "https://github.com/Hantu-Raya/3d-hud-web-merger/commit/1234567890abcdef"
  );
  assert.equal(
    buildCommitUrl("git@github.com:Hantu-Raya/3d-hud-web-merger.git", hash),
    "https://github.com/Hantu-Raya/3d-hud-web-merger/commit/1234567890abcdef"
  );
});

test("createGitCommitInfo exposes the short hash and commit URL", () => {
  const info = createGitCommitInfo({
    hash: "b1fd667e7fe467f7d8b352c7ad0607e6618c3a79",
    remoteUrl: "https://github.com/Hantu-Raya/3d-hud-web-merger.git",
    subject: "Add merge status metadata"
  });

  assert.equal(info.hash, "b1fd667e7fe467f7d8b352c7ad0607e6618c3a79");
  assert.equal(info.shortHash, "b1fd667e7fe4");
  assert.equal(info.url, "https://github.com/Hantu-Raya/3d-hud-web-merger/commit/b1fd667e7fe467f7d8b352c7ad0607e6618c3a79");
  assert.equal(info.subject, "Add merge status metadata");
  assert.equal(info.title, "Latest commit b1fd667e7fe4: Add merge status metadata");
});

test("createGitCommitInfo shows the PR title and branch for GitHub merge commits", () => {
  const info = createGitCommitInfo({
    hash: "cac441a188dbb55f0fdf2c8bd742892e07b29cc7",
    remoteUrl: "https://github.com/Hantu-Raya/3d-hud-web-merger.git",
    subject: "Merge pull request #2 from Hantu-Raya/codex/add-repo-actions",
    body: [
      "Merge pull request #2 from Hantu-Raya/codex/add-repo-actions",
      "",
      "Add repo star and commit version chip"
    ].join("\n")
  });

  assert.equal(info.subject, "Add repo star and commit version chip");
  assert.equal(info.branch, "codex/add-repo-actions");
  assert.equal(info.title, "Latest update: Add repo star and commit version chip | Branch: codex/add-repo-actions");
});

test("createGitCommitInfo links GitHub merge commits to the source branch commit", () => {
  const sourceHash = "a651848e3a3a9e0faec67dba4454e1ec63c62a24";
  const mergeHash = "cac441a188dbb55f0fdf2c8bd742892e07b29cc7";
  const info = createGitCommitInfo({
    hash: mergeHash,
    sourceHash,
    remoteUrl: "https://github.com/Hantu-Raya/3d-hud-web-merger.git",
    subject: "Merge pull request #2 from Hantu-Raya/codex/add-repo-actions",
    body: [
      "Merge pull request #2 from Hantu-Raya/codex/add-repo-actions",
      "",
      "Add repo star and commit version chip"
    ].join("\n")
  });

  assert.equal(info.hash, sourceHash);
  assert.equal(info.mergeHash, mergeHash);
  assert.equal(info.shortHash, "a651848e3a3a");
  assert.equal(info.url, `https://github.com/Hantu-Raya/3d-hud-web-merger/commit/${sourceHash}`);
});

test("createGitCommitInfo returns null when required git data is missing", () => {
  assert.equal(createGitCommitInfo({ hash: "", remoteUrl: "https://github.com/Hantu-Raya/3d-hud-web-merger.git" }), null);
  assert.equal(createGitCommitInfo({ hash: "abc", remoteUrl: "" }), null);
});
