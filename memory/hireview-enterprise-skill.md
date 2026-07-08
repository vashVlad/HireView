---
name: hireview-enterprise
description: Enterprise-scale product decisions for HireView — feature prioritization, UI/UX standards, roadmap governance, and competitive positioning. Use when Vlad asks about what to build next, whether a feature is worth adding, how the interface should work, or how to position HireView against competitors. This skill prevents feature bloat, enforces the trust-layer identity, and applies 2026 enterprise SaaS standards to every decision.
---

# HireView Enterprise Product Guide

## Identity (never drift from this)
HireView is the verification and trust layer for AI recruiting.
NOT an ATS. NOT a sourcing tool. NOT a feature-packed platform.
Every feature must answer: does this increase trust, reduce fraud, or improve recruiter decision quality?

## Feature Gate — ask before building anything
1. Does a real user (Teti, Suchin, Indrani) feel this pain today?
2. Can impact be measured within 30 days?
3. Does it reinforce the trust-layer identity?
4. Does it reuse something already built?
If any answer is no — log it as roadmap, don't build it now.

## Enterprise UI Principles (2026)
- Get in, complete the task, get out. Every screen has one job.
- Progressive disclosure: show headline info first, drill down on demand
- Role-aware views: recruiter sees their pipeline, admin sees everything
- Every action attributed: who did what, when — visible at a glance
- Fraud signals surface immediately — never buried in a detail view
- Empty states are invitations to act, not blank screens
- Errors explain what went wrong and how to fix it
- No feature ships without a clear empty state and error state

## UI Anti-patterns to avoid
- Settings pages nobody fully understands
- Features that require training to use
- Cognitive load as the primary experience
- Flashy animations that slow down task completion
- Generic AI summaries nobody reads (Reval's failure)

## Current Stack
Next.js (App Router) · Tailwind · Claude (claude-sonnet-4-6) · Supabase · Vercel · TypeScript

## Roadmap Governance
Phase 1 (NOW): Fraud prevention — duplicate detection, attribution, teams, history alerts, fraud-aware interview questions
Phase 2 (30 days): Intelligence — cross-project fit suggestion, contextual search, unified view, LinkedIn comparison
Phase 3 (post-demo): Scale — proxy detection, ATS integration, role analytics, social graph
Never build: autonomous AI interviewing, full ATS replacement, job posting/sourcing

## Competitive Position
- Reval ($8k/hire): sources and screens but scores fake resumes, zero fraud detection
- Hivemind: full ATS workflow, no verification layer
- HireView wins on: fraud fingerprinting, credibility verification, calibration learning, human-in-loop trust

## Prior Art Protection
Calibration system and credibility checker are potentially patentable.
Any new novel implementation must be logged in HireView_Prior_Art_Document immediately.
Use personal resources only — never employer equipment, credits, or infrastructure.
