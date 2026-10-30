# Manual QA before each release

Automated tests cover most of this; these checks catch what they cannot (real vaults, real
networks, real TopK). Record the result in the release PR.

## Platforms

- [ ] macOS: latest Obsidian, and 1.11.4 if available
- [ ] Windows: latest Obsidian
- [ ] Linux: latest Obsidian (AppImage or Flatpak)

## Fresh install

- [ ] Install through BRAT (`docs/BETA.md`) into an empty vault; the plugin loads with no errors in the console
- [ ] No key set: Visual search and Index vault show the "needs a TopK API key" notice with a working settings link
- [ ] Test connection with a wrong key says the key was rejected; with a right key says Connected

## Indexing

- [ ] First index shows the dialog with page count and cost; Cancel uploads nothing
- [ ] Start indexing shows progress in the status bar; Cancel stops it; Index vault again resumes
- [ ] A vault with 5,000+ pages indexes without Obsidian becoming unresponsive; memory stays reasonable
- [ ] A vault with no PDFs or images: Index vault reports the index is up to date
- [ ] Turn off Wi-Fi mid-index: status bar shows "Offline, will resume"; turning it back on resumes and finishes
- [ ] Quit Obsidian mid-index and reopen: the run finishes in the background without re-uploading finished files
- [ ] Add, rename, move and delete a PDF: the index follows within a few seconds (Show index status)

## Search

- [ ] Hero query on the demo vault opens `talk.pdf` on page 3
- [ ] Thumbnails, page numbers and snippets appear; arrow keys and Enter work
- [ ] Save results as note writes working `[[file.pdf#page=N]]` links
- [ ] A long screenshot shows up as one result and opens the image

## Data

- [ ] Remove my data from TopK empties the index; search says nothing is indexed
- [ ] Rebuild index re-uploads everything (cost shown first)
- [ ] The debug log never shows the API key
