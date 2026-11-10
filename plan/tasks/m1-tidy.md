## What
Stage one: an inventory of everything at the top level and in tools and docs; dead things archived or deleted; working data moved out of the root; the front-door documents corrected; a README in every top-level directory; and a layout check that fails when the top level grows or a file gets too long. Stage two, after the running lanes merge: the live scripts in tools folded into the packages they serve, and the loop package made readable, with its prompts as plain files.
## Why
Aaron opened the repository and could not make sense of it: run folders at the top level, twenty loose scripts and thirty-one old workflow scripts in tools, a spike still sitting there, books beside a book package, and a loop package he could not follow.
## Done when
- The top level holds only directories a newcomer can explain from the README
- tools holds no loose script that belongs to a package
- The layout check passes and is part of the tests
