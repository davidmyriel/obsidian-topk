# Launch posts (drafts)

_For Dave to edit and post. Nothing here is posted automatically. Replace **[blog link]** with the
published post's URL, with a UTM tag per channel, e.g. `?utm_source=hn&utm_campaign=obsidian-launch`,
so new TopK API keys can be counted for 14 days (PLAN.md)._

Suggested order (docs/research/audience.md): Show HN and the Obsidian forum on day one;
r/ObsidianMD and the Obsidian Discord the same week; a technical write-up for r/MachineLearning
later.

## Show HN

**Title:** Show HN: Search your Obsidian PDFs and slides by what's on the page

**Text:**

I kept failing to find slides in my own notes. I'd remember "the diagram with the reranker in the
middle", search for "reranker", and get every paper that mentions reranking but not the slide,
because its only text was "Stage 1 / Stage 2".

This Obsidian plugin uploads each PDF page and image as an image to a TopK collection, embeds it
with a multi-vector vision model (topk-embed-v1), and searches with late interaction. You describe
the page and get the page back, with a thumbnail and a link that opens the PDF there.

Some details:

- Renames are free (pages are keyed by content hash), deletes propagate, interrupted indexing
  resumes, and it shows a cost estimate before uploading (about $0.13 per 1,000 pages).
- File names and paths stay local; only page images and query text go to TopK.
- I benchmarked it against text search (what Omnisearch + Text Extractor do) and Gemini
  Embedding 2 on 1,026 pages of CC BY papers and slides. On vague, half-remembered queries it
  finds the page first 48% of the time and in the top 5 74% of the time, against 4% and 26% for
  text search. **[Gemini numbers.]** The labels were written by me, and the caveats are in the
  post.

Code, benchmark and corpus: https://github.com/davidmyriel/obsidian-topk
Write-up: **[blog link]**

Disclosure: I work on TopK, and this runs on TopK's API.

## r/ObsidianMD

**Title:** I made a plugin that finds the PDF page or slide you're thinking of, from a description

**Body:**

If your vault is full of papers, slide decks and screenshots, you've probably had this: you remember
a figure, but search only knows about words, and the figure has none.

TopK Visual Search indexes each PDF page and image as a picture. Then you type something like
"bar chart comparing run times of Fortran and Python" and it opens that page.

- Works on PDF, PNG, JPEG and WebP. Desktop only, Obsidian 1.11.4+.
- Shows the page count and cost before uploading anything, keeps itself up to date, and has a
  "Remove my data" command.
- It's a cloud service (TopK). File names stay local, but page images are uploaded, so don't index
  anything confidential. New accounts get $10 of credits, which covers tens of thousands of pages.
- Install with BRAT: `davidmyriel/obsidian-topk`.

How it compares with text search on 1,026 pages: **[blog link]**. Happy to answer questions, and
I'd love to hear what it misses on your vault.

## Obsidian forum: Share & showcase

**Title:** TopK Visual Search: find PDF pages and images by describing them

**Body:** same as r/ObsidianMD, plus a short GIF at the top (docs/images/demo.gif) and a link to the
2020 feature request for searching text inside images and PDFs.

## X

1. Searching notes by words fails when the thing you remember is a figure. I built an Obsidian
   plugin that searches PDFs, slides and screenshots by what's on the page. 🧵 **[GIF]**
2. Each page is uploaded as an image, embedded with a multi-vector vision model, and searched with
   late interaction. Describe the page, get the page.
3. On 1,026 pages of papers and slides, with vague half-remembered queries: right page first 48% of
   the time vs 4% for text search. **[Gemini comparison.]** Method and caveats: **[blog link]**
4. Free, MIT, installs with BRAT: github.com/davidmyriel/obsidian-topk
