// Media's door: no procedures. A procedure writes another concept's table only for one money fact
// (rules.procedures), and no stored file is one: a logo, a photo or an identity document moves,
// reserves, routes and owns no money. Media points at no one (concepts.media), so no concept writes
// media's table either: every file is written by its own upload (`media.files.upload`). Concepts
// that depend on media read `files` directly, at the caller's own key, to check that a file they
// are given is the caller's, of the right purpose, and not expired. Decision: media.door.

export {};
