# REGULATORY_SOURCES.md

Inventory and verification tracker for the regulatory sources behind BankShield AZ.

**Status as of 2026-10-15 (status names updated to PENDING_VERIFICATION, UNDER_LEGAL_REVIEW, VERIFIED, SUPERSEDED; findings unchanged): NO source is verified.** All three URLs were reachable and returned content, but the content was read through an automated page summarizer. No clause text has been checked against an official source by a human. Until a person completes the tasks below, every imported requirement stays `PENDING_VERIFICATION` and is excluded from definitive compliance scoring.

BankShield AZ is a compliance support tool. It is not approved by the Central Bank of Azerbaijan and does not guarantee legal compliance.

## Source inventory

### S1: CBA Regulations on Information Security Management in Banks
- URL: https://www.cbar.az/law-370/regulations-on-information-security-management-in-banks?language=en
- Retrieved: yes (English version). The scraped copy was cut off partway through Section 7 in the visible body; the metadata description ran through Section 15 and Annex 1.
- Issuer: Central Bank of the Republic of Azerbaijan
- Decision number/date: **CONFLICT.** The body text suggests Decision No. 20/1 of 14 July 2021; the page metadata suggests No. 20/114, July 2021. Must be resolved against the official publication.
- Effective date: not found on the page
- Amendments: none shown on the page (absence on one page is not proof there are none)
- Scope (clause 1.1, per summary): banks and local branches of foreign banks
- Structure seen: Sections 1 to 15 plus Annex 1, decimal clause numbering up to five levels (for example 7.4.3.7)
- Original Azerbaijani version: linked from the page, **not reviewed**
- Verification status: `PENDING_VERIFICATION`

### S2: CBA Information Security Requirements for Supervised Entities in Financial Markets
- URL: https://uploads.cbar.az/assets/Information%20security%20requirements%20for%20supervised%20entities%20in%20financial%20markets%20.pdf
- Retrieved: yes (PDF, English; appears to be a translation, original language not indicated)
- Issuer: Central Bank of the Republic of Azerbaijan
- Decision number/date: Decision No. 14/2 of 28 March 2024 (per summary; verify)
- Effective date: not found in the text
- Scope (item 1.1, per summary): banks, non-bank credit institutions (excluding credit unions), insurers, securities market licensees, investment funds and managers, the national postal operator, payment institutions, e-money institutions, payment system operators, credit bureaus, central depository
- Tiering: entity Categories I, II, III (items 2.1.34 to 2.1.36) with exemptions for II and III (items 1.4, 1.5). The category a given bank falls into must be established before scoping.
- Structure seen: Sections 1 to 8 and Annexes 1 to 4
- Verification status: `PENDING_VERIFICATION`

### S3: Law of the Republic of Azerbaijan on Personal Data (Fərdi məlumatlar haqqında)
- URL: https://frameworks.e-qanun.az/19/c_f_19675.html
- Retrieved: yes (Azerbaijani)
- Law number/date: No. 998-IIIQ of 11 May 2010 (per summary; verify)
- Effective date: not found on the page
- Amendments listed on the page: No. 995-IVQD of 20 June 2014 (added Art. 13.2-1); No. 1066-VQD of 3 April 2018 (reworded Art. 13.2-1). The page's footnote has a publication date earlier than the law's own date, which looks like a source inconsistency to check.
- Current status: **not confirmed.** The page lists amendments only through 2018. It must be checked whether later amendments or a replacement exist.
- Structure seen: Chapters I to V, Articles 1 to 19
- Verification status: `PENDING_VERIFICATION`

## Open legal questions for a human reviewer

1. **Overlap between S1 and S2.** S2 (2024) lists banks in its scope. Does it replace, supplement, or coexist with S1 (2021) for banks? This determines which document is authoritative for each topic. Do not assume either answer.
2. **Which category (I, II, III) applies to the target bank** under S2.
3. **Effective dates** for S1, S2, S3 from the official gazette or the issuer.
4. **Decision number for S1** (20/1 vs 20/114).
5. **Latest consolidated text of S3** and any post-2018 amendments.
6. **Original Azerbaijani text** of S1 and S2. The English text must be stored as a labeled translation, never as the source clause.
7. **Whether the CBA publishes any other binding instruments** relevant to bank cybersecurity (for example incident-reporting templates referenced by annexes). Do not add them without verification.

## Verification workflow

For each requirement imported, record at minimum:

| Field | Notes |
|---|---|
| source_document | One of S1, S2, S3 |
| clause_identifier | Exactly as printed (for example `7.4.3.7`, `Art. 10`) |
| source_url | Exact URL |
| original_text_az | Original Azerbaijani wording, when obtained |
| translation_en | Separate field, flagged as translation, with translator/source |
| institution_type | Applicability, including S2 category if relevant |
| effective_from / effective_to | From the official record only |
| verification_status | `PENDING_VERIFICATION` (default), `UNDER_LEGAL_REVIEW`, `VERIFIED`, `SUPERSEDED` |
| verified_by / verified_at | Named human reviewer and date |
| requirement_type | `MANDATORY_LAW` or `OPTIONAL_FRAMEWORK` (ISO 27001, NIST) |

Rules:
- Only a human reviewer can set `VERIFIED`. Import and AI processes cannot.
- `PENDING_VERIFICATION` requirements may be browsed and mapped but never count toward a compliance score.
- Do not invent fines, deadlines, or interpretations. If a clause says nothing about a deadline, none is stored.
- Seed data for development must use clearly fictional placeholder requirements, labeled as such, never fabricated clause text attributed to a real source.

## Verification task checklist

- [ ] Obtain the official Azerbaijani text of S1 and confirm decision number, date, effective date, amendments
- [ ] Obtain the official Azerbaijani text of S2 and confirm the same
- [ ] Confirm the current consolidated text and amendments of S3
- [ ] Resolve the S1/S2 overlap question with a qualified legal or compliance reviewer
- [ ] Decide the starting set of requirements (small, for example 10 to 20) and import them as `PENDING_VERIFICATION`
- [ ] Reviewer checks each against the official text and promotes to `VERIFIED`
