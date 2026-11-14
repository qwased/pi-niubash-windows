# Attribution — bundled references

The four reference documents below are bundled **verbatim** from the Niubash skill bundle, with no
content changes. The upstream license text is included as `LICENSE`; its line-ending normalization
is noted below:

| File | Bytes | SHA256 |
|---|---|---|
| `paths.md` | 3911 | `a505a13693a33e9cea32b19596336ffbb747c7a257c44c45547ece33e673935b` |
| `prompt-plugins.md` | 5606 | `251b1298878107932cc1f5e85406902ea9aee5e6e328acb633defcd89092ed4b` |
| `quickref.md` | 11077 | `053361a92a4eebe245a3f0586fbab4a94789833023603b2783cc7b7ba54092b9` |
| `wpm.md` | 1942 | `791aab2507ce1b2a74f9d1a0b73271651a578fc28f64527db250c5231ee209cc` |
| `LICENSE` | 1069 | `1290aae99e71239ee3154e7847830e49e7a36c758fa6d659d73fa752dc9f81c8` |

- Source project: <https://github.com/unixwin/niubash>. The URL and the MIT license were verified
  in the `README.md` and `LICENSE` files of the installed Niubash 1.5.0 tree.
- Snapshot: the skill bundle shipped with that install; the bundle files carry a
  2026-11-03 file timestamp, and the copies here were re-verified byte-for-byte on 2026-11-14.
- **Commit / tag: unknown.** The bundle carries no git metadata, so the exact upstream commit or
  release tag that produced these files cannot be verified from this copy. The Niubash version
  number is not a commit identifier; do not treat it as one.
- License: MIT, Copyright (c) 2026 unixwin team. The full upstream license text is reproduced in
  [LICENSE](LICENSE) in this directory. It was copied from the installed Niubash 1.5.0 tree and its
  CRLF line endings were normalized to LF so the committed bytes match the published tarball; its
  SHA256 above is therefore of the normalized file, while the four documents are byte-for-byte
  upstream. The package's own MIT license is the repository-root `LICENSE` file.

`skill/SKILL.md` is a Pi-specific rewrite and does not reproduce the upstream skill text
wholesale; consult upstream for the canonical skill.

When updating Niubash, diff these files against the new bundle, record the new hashes and the
capture date, and refresh them rather than editing in place, so provenance stays verifiable.