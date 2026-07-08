# HireView — Product Roadmap
**Owner:** Vladyslav Vashchuk
**Last Updated:** July 8, 2026
**Strategic Position:** Trust & Verification Layer for AI Recruiting

---

## North Star
HireView is not an ATS. It is the verification layer that makes any sourcing tool safe to use at scale. Every feature must answer: does this increase trust, reduce fraud, or improve recruiter decision quality?

---

## PHASE 1 — FRAUD PREVENTION (NOW)
*Goal: Beat Reval at the $8k/hire evaluation. Demo to Suchin and Indrani.*

| # | Feature | Problem Solved | Priority |
|---|---------|---------------|----------|
| 1.1 | Duplicate Resume Detection | Catches word-for-word resumes under different names. Match on skills hash, responsibility vectors, metric claims, career arc — NOT names/contact info | CRITICAL |
| 1.2 | Recruiter Attribution | "Vlad screened John on July 7" — every action logged with name + timestamp. Admin sees full candidate activity timeline | CRITICAL |
| 1.3 | Teams Architecture | Admin → Team → Projects → Users. Recruiters see only their assigned teams. Full isolation. | CRITICAL |
| 1.4 | Candidate History Alert | Resume re-submitted across projects? Yellow PREVIOUSLY SEEN banner. Known fraud pattern? Red KNOWN FRAUD PATTERN banner | HIGH |
| 1.5 | Fraud-Aware Interview Questions | When duplicate/credibility flag exists, interview questions probe the specific inconsistency — not just role fit | HIGH |

**Reuse:** Credibility Checker (already built) feeds into 1.5. Existing multi-user auth feeds into 1.3. Existing interview questions feature feeds into 1.5.

---

## PHASE 2 — INTELLIGENCE LAYER (NEXT 30 DAYS)
*Goal: Make HireView smarter than any recruiter working alone.*

| # | Feature | Problem Solved | Priority |
|---|---------|---------------|----------|
| 2.1 | Cross-Project Fit Suggestion | Resume scores 35 on FDE → HireView suggests AI Developer role where score is 73. Prevents good candidates lost to wrong role | HIGH |
| 2.2 | Contextual Search | "Incident response" understood as implying specific cybersecurity stack. Semantic synonyms, not keyword matching | HIGH |
| 2.3 | Smart Unified Candidate View | Cross-project dashboard: all candidates, filterable by fraud flag, score, stage, recruiter, date. Director-level visibility | MEDIUM |
| 2.4 | LinkedIn Comparison | Upload LinkedIn PDF alongside resume → surface mismatches in dates, titles, skills, network signals. Extends existing Credibility Checker | MEDIUM |

**Reuse:** Existing JD analyzer semantic logic feeds into 2.2. Existing All Candidates page becomes 2.3 with filters added. Existing Credibility Checker becomes 2.4 with LinkedIn-specific prompting.

---

## PHASE 3 — SCALE & DEFENSE (POST-SUCHIN DEMO)
*Goal: Make HireView ready for enterprise use and impossible to replace.*

| # | Feature | Problem Solved | Priority |
|---|---------|---------------|----------|
| 3.1 | Proxy Interview Detection | Compare interview performance profile against first-week work output signals. Long-term identity verification play | FUTURE |
| 3.2 | Reval/ATS Integration | Accept candidate submissions from Reval or Lever → run through HireView fraud layer → return verified candidates | FUTURE |
| 3.3 | Role-Based Analytics | Director sees team-wide fraud signals, throughput, recruiter performance. Recruiter sees only their pipeline | FUTURE |
| 3.4 | Candidate Social Graph | LinkedIn mutual connections, activity patterns, comment history as fraud signals | FUTURE |

**Reuse:** Teams architecture from Phase 1 feeds directly into 3.3. Credibility Checker feeds into 3.4.

---

## NEVER BUILD
- Autonomous AI interviewing (Reval's play — doesn't solve human-in-the-loop problem)
- Full ATS replacement (Hivemind's play — too broad, not our market)
- Job posting or sourcing (commodity — not defensible)

---

## Current Build Queue (Cowork)
Phase 1 features 1.1 → 1.2 → 1.3 → 1.4 in that order. 1.5 added after 1.4 complete.

## Logged Problem Statements
1. Cross-project fit suggestion (Phase 2.1)
2. Competitive positioning vs Reval — verification layer
3. Reval integration opportunity (Phase 3.2)
4. Smart unified candidate view (Phase 2.3)
5. Fraud-aware interview questions (Phase 1.5)

## Competitive Position
| Competitor | Their Strength | Their Gap | HireView Advantage |
|-----------|---------------|-----------|-------------------|
| Reval ($8k/hire) | Autonomous sourcing + AI screening | Zero fraud detection, scores fake resumes | Fraud fingerprinting, credibility verification, human-in-loop trust |
| Hivemind | Full ATS workflow | No fraud layer, no verification | Fraud prevention, calibration learning, attribution |

