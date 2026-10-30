# Who TopK Visual Search for Obsidian Is For

> **Corrections, 2026-10-30** (from building and testing the plugin; the research below is
> unchanged):
>
> 1. **Cost:** image embedding is a flat $0.075 per 1,000 images (TopK's topk-embed-v1
>    announcement), not per-token text pricing. With upload and storage, indexing costs about
>    **$0.13 per 1,000 pages**, not ~$0.06. Priya's 9,000 pages cost about $1.20; $10 covers roughly
>    65,000–110,000 pages, not ~166,000. "Less than a dollar" should read "about a dollar". See
>    `docs/spikes/E-topk-embed-v1.md`.
> 2. **Demo corpus licences:** "Attention Is All You Need", ColBERT (2004.12832) and RAG
>    (2005.11401) are under arXiv's default licence, which does not allow redistribution, so they
>    cannot ship in a sample vault. Use CC BY or CC0 papers; 11 checked ones are listed in the test
>    set used on 2026-10-30 (ColPali, ColBERTv2, Mixtral, Qwen, Phi-3, SWE-bench, LLaVA, QLoRA,
>    Chain-of-Thought, M3-Embedding, Document Screenshot Embedding).
> 3. **Mobile:** the plugin is desktop-only (`isDesktopOnly`) and does not load on phones, so
>    Obsidian Sync does not carry search to mobile.
> 4. **Highlighting the matched region** is not possible: TopK does not return per-token MaxSim
>    scores (also blocks PLAN.md's Stage 4 heatmap).
> 5. **"~100 lines on top of the TopK API"** is not accurate for the plugin, which ships its own gRPC
>    client (ADR-001). The developer pitch should instead show the ~15 lines of SDK code an app needs:
>    an `image()` field with `semantic_index()`, upsert images, query with `semantic_similarity`;
>    TopK embeds server-side, so no MaxSim code is involved (ADR-002).
> 6. **Handwriting as a hero query is risky:** in a spot check, "handwritten letter" missed a
>    handwritten page in Gurmukhi script. Test any handwriting query before using it in launch
>    material.
>
> Already built (Stages 1–2): folder include/exclude, the pre-index cost estimate, the data
> statement (`docs/PRIVACY.md`), background incremental indexing, result thumbnails and one-click
> page links. Not decided: moving Zotero folder indexing and a local xsmall mode ahead of launch.

The primary target is the ML/AI engineer or applied ML researcher who uses Obsidian on a desktop as a research notebook: a vault full of arXiv papers, conference talk slides, architecture diagrams, benchmark charts and whiteboard photos. This person has the sharpest version of the "I know I saw that figure somewhere" problem, is already comfortable sending data to cloud APIs, and is the exact person who might later build a RAG or search product on TopK. Everyone else is a secondary audience at best.

## TL;DR

- **Primary target:** ML/AI engineers and applied ML researchers (including CS/ML PhD students) with desktop Obsidian vaults heavy in papers, slides and diagrams. They score highest on pain × willingness to use cloud × overlap with TopK's developer buyers. At the plugin's own estimate of ~$0.06 per 1,000 pages, a typical vault of a few thousand pages costs well under $1 to index, and TopK's $10 signup credit covers that. TopK's pricing page lists embedding per token, not per page.
- **Secondary targets:** (1) Zotero-based STEM PhD students and academic researchers who are not ML specialists, and (2) software engineers, SREs and technical founders whose vaults are full of screenshots, architecture diagrams and design-doc PDFs. Handwriting/e-ink users (reMarkable, GoodNotes) feel real pain but are a weaker GTM fit.
- **Not for:** text-only note takers, privacy-first local-only users (a large and vocal part of the Obsidian base), lawyers and medical professionals with client/patient documents, mobile-only users, and consultants with client-confidential decks. Lead the launch with an ML-papers-and-slides demo, a "show me the TopK code behind this" link, and a local xsmall mode as the answer to privacy objections.

## Key Findings

**1. The Obsidian market for "search inside PDFs and images" is real, large and badly served.**

- Obsidian's built-in search does not look inside PDFs or images.\[1\] A reMarkable sync plugin states it plainly: "Obsidian's own search pane does not look inside PDFs."\[2\]
- The workaround stack is Omnisearch (about 2.06 million downloads) plus Text Extractor (333k downloads).\[3\]\[4\] Text Extractor's own README warns "🟥 PDF files often fail to get their text extracted 🟥" and its maintainer says he "can't dedicate much time anymore" to it.\[5\]
- Users report the stack failing at scale. One forum user said Omnisearch was "missing around 60% of the pdfs (empty text in the metadata)".\[6\] A GitHub issue reports Obsidian crashing at 4 GB of memory while Omnisearch indexed about 1,500 documents including large OCR'd PDFs.\[7\] Another reports macOS killing Obsidian after Omnisearch sent six large photos to OCR at once.\[8\] A third, from a vault with 271 PDFs in a "uni" folder, says indexing "crashes every time."\[9\] A Japanese user measured Omnisearch adding 9.2 seconds of load time and +668 MB of memory in a huge vault and built a replacement.\[10\]
- The request is old and persistent. The forum thread "OCR images/screenshots to make them searchable" opened in October 2020: "During meetings, I often paste screenshots containing large blocks of text… It would be valuable to be able to have search include the words."\[11\] Another user in that thread: "I'm taking notes from a video right now (lots of screenshots pasted right into obsidian)… I used to do this in onenote and now I can't search the images."\[11\]
- Every existing tool is text-first. OCR plugins (Text Extractor, OCR Extractor, Handwriting OCR, AI Image OCR) turn pixels into words.\[12\]\[13\]\[14\]\[15\] None of them can answer "the bar chart comparing p99 latency" or "the slide with the reranker architecture diagram", because those queries describe what a page looks like, not words printed on it. In April 2022, forum user louis030195 posted a "Multimodal semantic search" plugin idea built on open_clip and clip-retrieval ("I'm the only one who has trouble finding notes in obsidian sometimes?"). They reported "The code for the obsidian plugin is 80% done" but "search results not great yet," and it never shipped as a mature plugin. This gap is the plugin's opening.

**2. The demand signals point to research, diagram and AI-heavy users.**

| Plugin                                    | Downloads | What it tells you                                                                                                                                                                                  |
| ----------------------------------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Excalidraw                                | ~8.76M    | Diagrams and sketches are mainstream in Obsidian                                                                                                                                                   |
| Copilot (AI agents/chat)                  | ~3.02M    | Millions plug AI, mostly cloud models, into their vault. A 2026 comparison by unabyss.com names Copilot the top Obsidian AI plugin out of a registry of 9,371 community plugins (October 23, 2026) |
| Omnisearch                                | ~2.06M    | Large demand for better search than the built-in one                                                                                                                                               |
| Smart Connections (local semantic search) | ~1.2M     | Semantic search is wanted, and "local, no API key" is a selling point\[16\]\[17\]                                                                                                                  |
| PDF++                                     | ~862k     | Heavy PDF reading and annotation inside Obsidian                                                                                                                                                   |
| Zotero Integration (desktop only)         | ~592k     | A large academic/research segment; desktop-only plugins can still reach scale                                                                                                                      |
| Text Extractor                            | ~333k     | Strong demand for searching inside images/PDFs, served by a fragile tool                                                                                                                           |
| OCR Extractor                             | ~10k      | Newer paid/cloud OCR options get traction but stay niche                                                                                                                                           |

Reading this table: the research/PDF cluster (PDF++, Zotero Integration) is in the high hundreds of thousands of installs, AI-in-the-vault is in the millions, and "search inside non-text files" is a proven need that current tools serve poorly. Obsidian runs no analytics. CEO Steph Ango estimated "roughly 1 million users" from GitHub download counts, as reported by Jared Newman in Fast Company in October 2023. Higher figures such as "1.5 million active users" circulate on social media but are not confirmed.

**3. Privacy is the main filter on who will say yes.**

Obsidian's appeal is local-first storage, and its privacy policy says local data is never sent to Obsidian's servers. Guides to Obsidian AI repeatedly tell users with sensitive notes to stay local: one 2026 guide says that if a vault holds private or work-confidential material, "keep it in a separate vault with no AI plugins, or use a fully local model."\[18\] Smart Connections leads its pitch with "Zero setup. No API key."\[17\] This means a cloud plugin will be rejected outright by a meaningful share of Obsidian users. It does not rule out the target: Copilot's ~3 million downloads show that a large group already sends vault content to cloud models.\[19\]

**4. TopK's economics make the target easy to convert.**

TopK's pricing page offers "Start with $10 free credits."\[20\] It prices "built-in multi-vector embeddings" at $0.05 per 1M tokens, billed separately from storage ($0.10/GiB-month) and query memory ($20/GiB-month), and it gives no per-page price. At the plugin's own estimate of ~$0.06 per 1,000 pages, $10 would cover roughly 166,000 pages, and a heavy ML researcher's vault of 500 papers at about 15 pages each (7,500 pages) would cost about $0.45 to embed. Those per-page figures are estimates to check against real billing. Even so, cost is not a barrier for the primary persona; the decision is about trust and setup friction, not money.

## Details

### Segment-by-segment assessment

Scores are 1 (low) to 5 (high). Pain = how often visual-only searches fail today. Cloud = willingness to send page images to a hosted API. Dev overlap = likelihood of becoming a TopK API customer. Signal = evidence of size in the Obsidian ecosystem. These scores are my judgment based on the evidence above, not survey data.

| Segment                                                                             | Signal | Pain | Cloud | Dev overlap | Score (Pain × Cloud × Overlap) |
| ----------------------------------------------------------------------------------- | ------ | ---- | ----- | ----------- | ------------------------------ |
| ML/AI engineers & applied ML researchers                                            | 3      | 5    | 4     | 5           | **100**                        |
| Software engineers / SREs / technical founders (screenshots, diagrams, design docs) | 4      | 3    | 4     | 5           | **60**                         |
| STEM PhD students & academics on Zotero (non-ML)                                    | 4      | 4    | 3     | 2           | **24**                         |
| Handwriting / e-ink users (reMarkable, GoodNotes, Supernote)                        | 3      | 4    | 3     | 2           | **24**                         |
| Undergraduate students with lecture slides                                          | 4      | 3    | 4     | 1           | **12**                         |
| Consultants / analysts with client decks                                            | 2      | 4    | 2     | 1           | **8**                          |
| Excalidraw-heavy visual thinkers                                                    | 5      | 2    | 3     | 2           | **12**                         |
| Designers with screenshot/moodboard vaults                                          | 2      | 3    | 3     | 1           | **9**                          |
| Lawyers / medical professionals with scanned records                                | 2      | 4    | 1     | 1           | **4**                          |

**ML/AI engineers and applied ML researchers (primary).** Their vaults contain exactly the content where text search fails: model architecture figures, loss curves, latency/benchmark tables rendered as images, and conference talk slides exported as PDF. The words that would find the page ("reranker", "p99") are often inside a figure, or absent. They already read papers that describe this very technique. ColPali, the paper behind this model family (Faysse et al., arXiv:2407.01449, June 2024, which also introduced the ViDoRe benchmark), argues that systems indexing text extracted "often through lengthy and brittle processes… struggle to exploit key visual cues efficiently." They use cloud APIs every day, and TopK's actual product (multi-vector search, page-image retrieval)\[21\] is something they might build into their own RAG systems. This is the only segment where a plugin user is very likely to also be a TopK buyer.

**Software engineers, SREs and technical founders.** Their vaults hold screenshots of dashboards, Grafana panels, architecture diagrams from design reviews, and vendor PDFs. Pain is moderate because much of their material is text. Developer overlap is high, which makes them the best secondary segment for TopK's business goal.

**STEM PhD students and academic researchers on Zotero.** This is the largest research segment (Zotero Integration ~592k downloads, PDF++ ~862k).\[22\]\[23\] Pain is real: finding "the figure with the phase diagram" across hundreds of papers. Two limits: many keep PDFs inside Zotero's storage folder, outside the vault, so the plugin must index that folder to matter; and outside CS/ML, few will become TopK API customers. Good for downloads and word of mouth, weak for signups.

**Handwriting and e-ink users.** Strong pain and visible activity. Several reMarkable-to-Obsidian sync plugins exist (Tagged Sync for reMarkable, reMarkable Sync, Scrybble),\[2\]\[24\]\[25\] and well-known Obsidian creator Nicole van der Hoeven published a 2026 reMarkable → Obsidian → OCR workflow.\[26\] A forum user reported: "I have imported my handwritten notes from goodNotes to obsidian and want to enable a search for handwritten notes… when I am doing omnisearch, it's not showing any handwritten notes in a search result."\[27\] The weak points: many of these users want transcription (editable text), not just search; LLM-based OCR is improving quickly; and the group is mostly not developers. Use handwriting as one hero query, not as the headline audience.

**Undergraduate students.** Plenty of lecture slides and GoodNotes PDFs, and 271-PDF "uni" folders show up in bug reports.\[9\] But many study on iPad/phone (this plugin is desktop-only), they rarely pay, and they will not become TopK customers.

**Consultants and analysts.** Decks are exactly the content this model is good at, but client decks are usually covered by confidentiality agreements, which rules out sending page images to a third-party API. Few keep decks in Obsidian rather than SharePoint/Drive.

**Excalidraw-heavy users.** Excalidraw is the most downloaded Obsidian plugin (~8.76M),\[3\] but its drawings are stored inside the vault in a text-based format, so labels in drawings are already partly searchable, and the plugin would need to render drawings to images to index them. Worth supporting later, not leading with.

**Designers.** Moodboard search is about visual style similarity ("warm minimal UI"), which is a different task from document-page retrieval. Low fit.

**Lawyers and medical professionals.** Highest privacy sensitivity; client and patient documents should not go to a cloud embedding API without a contract. Exclude from the launch, and make that explicit in the README.

### Primary persona

**Priya, 31, senior ML engineer at a 40-person AI startup building a search/recommendation product.**

- **Tools:** Obsidian on a MacBook with Obsidian Sync to a work desktop; Zotero for papers; Excalidraw for quick sketches; Copilot plugin with her own API key.
- **Vault contents:** about 600 arXiv PDFs (roughly 9,000 pages), 80 conference talk decks exported as PDF (NeurIPS, SIGIR, internal tech talks), 300 screenshots of Grafana dashboards and W&B loss curves, 40 iPad photos of whiteboard sessions, and her own handwritten notes on sharding designs.
- **A search that fails today:** She needs "the slide from that SIGIR talk with the two-stage retrieval → reranker diagram" for a design doc. She types "reranker" into Omnisearch. It returns 140 text hits from papers that mention reranking, and does not return the slide, because the slide's only text is "Stage 1 / Stage 2" inside a diagram. She spends 20 minutes paging through decks in Finder.
- **What the plugin changes:** She types "slide with two-stage retrieval and reranker diagram" and gets the exact page as `[[sigir-talk.pdf#page=14]]`, pastes the link into her design doc note, and moves on. At the plugin's estimated per-page rate, indexing her whole vault costs about $0.60, inside her $10 free credit.
- **Why she matters to TopK:** her team is evaluating vector databases for a document search feature. After seeing page-level retrieval work on her own files, the README's "this plugin is ~100 lines on top of the TopK API" link is the path to a work API key.

### Secondary personas

**Marco, 27, 4th-year PhD student in computational biology.** About 1,200 papers in Zotero, with PDFs in Zotero's storage folder; Obsidian with Zotero Integration and PDF++ for literature notes. Failing search: "the figure with the UMAP of T-cell clusters colored by timepoint", which he remembers seeing in "some 2023 Nature paper." Text search finds 60 papers that mention UMAP. The plugin finds the figure page. He uses cloud tools but asks whether his unpublished lab data gets uploaded (answer: only if it is in an indexed folder, so folder exclusion matters). Value to TopK: downloads, reviews, word of mouth in academic circles; low direct signup value.

**Sam, 35, staff SRE and founder of a side-project devtool.** Vault of incident postmortems with pasted Grafana screenshots, vendor architecture PDFs, and photos of whiteboard diagrams. Failing search: "the dashboard screenshot where p99 latency spiked after the deploy." OCR finds axis labels on 200 screenshots. The plugin finds the spike. High chance of trying the TopK API for his own product.

### Not for

- **Text-only note takers.** If the vault is Markdown with few attachments, there is nothing to index. Omnisearch or Smart Connections serves them.
- **Privacy-first, local-only users.** They choose Obsidian because nothing leaves the device. Do not try to convert them with the cloud version; offer the local xsmall mode later or leave them alone.
- **Lawyers, doctors, therapists and anyone with client/patient records.** Regulatory and confidentiality exposure. Say so in the README.
- **Consultants with client decks under NDA.** Same reason.
- **Mobile-only users.** The plugin indexes on desktop. Obsidian Sync can carry results to phones, but someone who only uses the phone cannot index.
- **People who want transcripts, not search.** Handwriting-to-Markdown users are better served by Handwriting OCR or LLM transcription plugins.\[13\]

### Where to reach the primary persona

| Channel                                                                                                                                 | Size / activity                                                | Why                                                                                                            |
| --------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| r/ObsidianMD                                                                                                                            | 361,773 members, +2.9% in about a month (Sep 2026 crawl)\[28\] | Where plugin launches get noticed; frequent plugin recommendation threads\[28\]                                |
| Obsidian Discord ("Obsidian Members Group")                                                                                             | ~194,796 members\[29\]                                         | Plugin showcase and AI channels; reaches power users                                                           |
| Obsidian forum: "Share & showcase" and "Plugins" categories                                                                             | Active (topic IDs past 119,000; posts through 2026)            | Official place to announce plugins; the 2020 OCR feature request thread is a natural place to reply            |
| Hacker News (Show HN)                                                                                                                   | Core developer audience                                        | Best single channel for the ML-engineer/technical founder overlap                                              |
| r/MachineLearning                                                                                                                       | ~3.1M members\[30\]                                            | The primary persona, but strict self-promotion rules; post a technical write-up, not an ad                     |
| r/LocalLLaMA                                                                                                                            | ~861K members, +55.6% per year\[31\]                           | ML practitioners who care about open weights; the right place for the xsmall local mode, not the cloud version |
| r/PhD                                                                                                                                   | ~293K members\[32\]                                            | Secondary persona (Marco)                                                                                      |
| r/zotero                                                                                                                                | ~15K members, +54% per year\[33\]                              | Small but exactly on-target for Zotero folder indexing                                                         |
| r/RemarkableTablet                                                                                                                      | ~82K members                                                   | Handwriting use case only (note: r/remarkable is a small ~3K unofficial sub)\[34\]                             |
| Hugging Face model pages for topk-embed-v1                                                                                              | Developer traffic already landing there                        | Link the plugin from the model card as a working demo                                                          |
| Obsidian YouTubers who cover research/AI workflows (e.g. Nicole van der Hoeven, who already published a reMarkable → Obsidian workflow) | Established audiences                                          | A demo video beats a text post for a visual search feature                                                     |

### Implications for the plugin and launch

**Demo corpus.** Ship a downloadable sample vault: around 50 well-known ML papers (Attention Is All You Need, ColPali, ColBERT, DPR and similar), 10 public conference talk decks, a handful of benchmark chart screenshots, and 5 photographed handwritten pages. This mirrors Priya's vault and lets people try it without uploading their own files, which also lowers the privacy barrier.

**Hero queries (show these in the README GIF and the Show HN post):**

- "slide with the reranker architecture diagram"
- "bar chart comparing p99 latency across systems"
- "figure showing attention heads as a heatmap"
- "table of BEIR nDCG@10 results"
- "my handwritten sketch of the sharding scheme"
- "Grafana screenshot where latency spikes"

Each should come with a side-by-side: what Omnisearch returns vs. what the plugin returns.

**Features that matter most to the primary persona, in order:**

1. **Index external folders, especially Zotero's storage folder**, so researchers do not have to copy PDFs into the vault.
2. **Folder include/exclude and a cost estimate before indexing** ("4,812 pages ≈ $0.29"), so users control exactly what leaves the machine.
3. **A clear data statement**: what is sent (page images), where, whether it is stored, and how to delete the index.
4. **Local mode with topk-embed-v1-xsmall** (0.8B parameters; a community MLX port for Apple Silicon already exists).\[35\]\[36\] This turns "I won't send my files to a cloud" into "fine, run it locally", and it is the version to post on r/LocalLLaMA.
5. **Incremental indexing** that never freezes Obsidian, since the Omnisearch crash reports show this is where existing tools lose trust.
6. **Result thumbnails with the page highlighted**, plus one-click `[[file.pdf#page=N]]` insert.
7. **Handwriting and screenshots as first-class file types**, but not the headline.

**GTM bridge to API signups.** The plugin is only a business win if it leads to API keys. Put these in the plugin: a "How this works" panel showing the ~20 lines of TopK code that index a page and run a MaxSim query; a link to a "build this for your product's documents" tutorial; and a signup flow that lands on the TopK console with the $10 free credit already explained.

**Messaging lines:**

- "Search your PDFs, slides and screenshots by what's on the page, not just the words."
- "Find the figure, not the 140 papers that mention it."
- "Your whole paper library indexed for less than a dollar."
- "Built on the same multi-vector page search you can put in your own product." (developer audience)
- "Don't want to upload? Run the open-weight model locally." (r/LocalLLaMA, privacy-minded users)

## Recommendations

1. **Commit to ML/AI engineers and applied ML researchers as the launch audience.** Build the README, demo vault, video and Show HN post around their files and their searches.
2. **Launch in this order:** Show HN and an Obsidian forum showcase post on day one; r/ObsidianMD and the Obsidian Discord the same week; a technical write-up for r/MachineLearning; the local-mode version for r/LocalLLaMA when it is ready.
3. **Build Zotero folder indexing and the pre-index cost estimate before launch.** Those two features unlock the largest secondary segment and remove the most common hesitation.
4. **Exclude regulated professions in writing** and avoid marketing to consultants and students. They inflate downloads but do not produce TopK customers, and they carry privacy risk.
5. **Measure the right thing:** track plugin installs → TopK API keys created → keys used outside the plugin (non-plugin API calls). The last number is the business result.

## Caveats

- **No survey data on Obsidian occupations.** The segment scores are judgments built from plugin download counts, forum threads and GitHub issues, not a measured breakdown of Obsidian's user base. Obsidian's own user counts are estimates.\[37\]
- **Pain quotes are about text-inside-images, not purely visual queries.** The forum evidence shows people cannot search the text in screenshots, PDFs and handwriting. I did not find a quote of someone searching specifically for "the chart that looks like X". The claim that visual-description queries are the bigger win is an inference from how ColPali-style models work, and should be tested with early users.
- **Download counts are cumulative and include updates/reinstalls**, so they overstate active users. Use them to compare plugins, not as audience sizes.
- **Subreddit and Discord sizes come from third-party trackers** (GummySearch, Prowlo, Discord invite snapshots) and vary by snapshot date.\[28\]\[38\]\[39\]
- **Handwriting may shrink as a differentiator.** LLM-based OCR is improving fast, so for handwritten text the gap between transcription and visual search will narrow; diagrams and charts will remain the durable advantage.

## Sources

1. [Obsidian Search Mastered - Quick Switcher, Search Operators and Bases](https://dsebastien.net/obsidian-search-mastered-quick-switcher-search-operators-and-bases)
2. [Tagged Sync for reMarkable - Obsidian Plugin](https://community.obsidian.md/plugins/remarkable-tagged-sync)
3. [Most Downloaded Obsidian Plugins](https://www.obsidianstats.com/most-downloaded)
4. [Text Extractor - Obsidian Plugin](https://community.obsidian.md/plugins/text-extractor)
5. [obsidian text extractor](https://github.com/scambier/obsidian-text-extractor)
6. [Global Search text in PDFs - Page 2 - Feature requests - Obsidian Forum](https://forum.obsidian.md/t/global-search-text-in-pdfs/511?page=2)
7. [Issue · scambier/obsidian-omnisearch](https://github.com/scambier/obsidian-omnisearch/issues/316)
8. [\[BUG\] Image indexing (OCR via Text Extractor) of large photos runs renderer out of memory (macOS kills Obsidian) · Issue #591 · scambier/obsidian-omnisearch · GitHub](https://github.com/scambier/obsidian-omnisearch/issues/591)
9. [\[BUG\] · Issue #526 · scambier/obsidian-omnisearch · GitHub](https://github.com/scambier/obsidian-omnisearch/issues/526)
10. [How I Fixed Broken Obsidian Search in a Huge Vault Using OS Indexing｜Gyroid](https://note.com/biomatter/n/n5166a67be971?hl=en)
11. [OCR images/screenshots to make them searchable](https://forum.obsidian.md/t/ocr-images-screenshots-to-make-them-searchable/6854)
12. [AI Image OCR - Obsidian Plugin](https://community.obsidian.md/plugins/ai-image-ocr)
13. [handwriting ocr obsidian plugin](https://github.com/ikmolbo/handwriting-ocr-obsidian-plugin)
14. [AI Image OCR](https://www.obsidianstats.com/plugins/ai-image-ocr)
15. [Obsidian plugins with #ocr - 13 plugins](https://www.obsidianstats.com/tags/ocr)
16. [Smart Connections - Obsidian Plugin](https://community.obsidian.md/plugins/smart-connections)
17. [GitHub - brianpetro/obsidian-smart-connections: Find related notes and excerpts while writing. Your link building copilot displays relevant content in graph + list view. A local embedding model powers semantic search. Zero setup. No API key. · GitHub](https://github.com/brianpetro/obsidian-smart-connections)
18. [Obsidian AI: Built-In Features, Plugins and Private Setup](https://coursiv.io/blog/obsidian-ai)
19. [Copilot](https://www.obsidianstats.com/plugins/copilot)
20. [Pricing](https://www.topk.io/pricing)
21. [topk-io/topk-embed-v1-small · Hugging Face](https://huggingface.co/topk-io/topk-embed-v1-small)
22. [Zotero Integration - Obsidian Plugin](https://community.obsidian.md/plugins/obsidian-zotero-desktop-connector)
23. [PDF++](https://www.obsidianstats.com/plugins/pdf-plus)
24. [reMarkable Sync for Obsidian: Sync Handwritten Notes as PDFs (2026)](https://keystone-studios.com/blog/remarkable-obsidian-sync-plugin)
25. [Scrybble Sync - Think analog, organize digital](https://scrybble.ink/)
26. [My reMarkable Obsidian workflow](https://nicolevanderhoeven.com/blog/20260703-my-remarkable-obsidian-workflow/)
27. [Search inside handwritten PDF (Imported from GoodNote) - Help - Obsidian Forum](https://forum.obsidian.md/t/search-inside-handwritten-pdf-imported-from-goodnote/56468)
28. [r/ObsidianMD Subreddit Stats — 362K members, +2.9% in 33d](https://prowlo.com/tools/subreddit-stats/obsidianmd)
29. [Join the Obsidian Members Group (OMG) Discord Server!](https://discord.com/invite/obsidianmd)
30. [r/MachineLearning - Subreddit for Machine-learning,...](https://thehiveindex.com/communities/r-machine-learning/)
31. [r/LocalLLaMA - Subreddit Stats & Analysis](https://gummysearch.com/r/LocalLLaMA/)
32. [r/programming - Subreddit Stats & Analysis](https://gummysearch.com/r/programming/)
33. [r/zotero - Subreddit Stats & Analysis](https://gummysearch.com/r/zotero/)
34. [r/Remarkable - Subreddit Stats & Analysis](https://gummysearch.com/r/Remarkable/)
35. [topk-io/topk-embed-v1-xsmall · Hugging Face](https://huggingface.co/topk-io/topk-embed-v1-xsmall)
36. [thoddnn/topk-embed-v1-xsmall-mlx · Hugging Face](https://huggingface.co/thoddnn/topk-embed-v1-xsmall-mlx)
37. [Obsidian Statistics 2026: Users, Revenue, Market Share, Growth & Valuation (Updated Monthly)](https://fueler.io/blog/obsidian-usage-revenue-valuation-growth-statistics)
38. [r/ObsidianMD - Subreddit Stats & Analysis](https://gummysearch.com/r/ObsidianMD/)
39. [r/ObsidianMD Stats & Best Posting Times](https://redditli.st/subreddit/ObsidianMD)
