interface HealthQuestionSnapshot {
  question: string;
  type: "yes_no" | "yes_no_explain";
  explainPrompt?: string;
}

interface HealthAnswer {
  questionIndex: number;
  answer: "YES" | "NO";
  explanation?: string;
}

interface ClauseInitial {
  clauseIndex: number;
  initials: string;
}

// North Carolina requires 18+ to be tattooed -- checked against the
// signing date, not the appointment date.
export function isAtLeast18(dateOfBirth: Date): boolean {
  const eighteenYearsAgo = new Date();
  eighteenYearsAgo.setFullYear(eighteenYearsAgo.getFullYear() - 18);
  return dateOfBirth <= eighteenYearsAgo;
}

// Every question in the snapshot must be answered by index; a
// yes_no_explain question answered YES additionally requires a non-empty
// explanation. Returns a field-level error naming the offending question
// rather than a generic "invalid" message.
export function validateHealthAnswers(
  snapshot: HealthQuestionSnapshot[],
  answers: unknown,
): { error: string; field: string } | { value: HealthAnswer[] } {
  if (!Array.isArray(answers) || answers.length !== snapshot.length) {
    return { error: "Every health question must be answered", field: "healthAnswers" };
  }

  const normalized: HealthAnswer[] = [];

  for (let i = 0; i < snapshot.length; i++) {
    const entry = (answers as Record<string, unknown>[]).find((a) => a && a.questionIndex === i);
    const answer = entry?.answer;

    if (!entry || (answer !== "YES" && answer !== "NO")) {
      return { error: `Please answer: "${snapshot[i].question}"`, field: `healthAnswers.${i}` };
    }

    if (snapshot[i].type === "yes_no_explain" && answer === "YES") {
      const explanation = entry.explanation;
      if (typeof explanation !== "string" || explanation.trim().length === 0) {
        return {
          error: `Please provide an explanation for: "${snapshot[i].question}"`,
          field: `healthAnswers.${i}.explanation`,
        };
      }
    }

    normalized.push({
      questionIndex: i,
      answer,
      explanation: typeof entry.explanation === "string" ? entry.explanation.trim() || undefined : undefined,
    });
  }

  return { value: normalized };
}

// All clauses in the snapshot must be individually initialed by index --
// count must equal the snapshot length exactly (Phase 4 spec: "count must
// equal the snapshot length").
export function validateClauseInitials(
  snapshot: string[],
  initials: unknown,
): { error: string; field: string } | { value: ClauseInitial[] } {
  if (!Array.isArray(initials) || initials.length !== snapshot.length) {
    return { error: `All ${snapshot.length} clauses must be individually initialed`, field: "clauseInitials" };
  }

  const normalized: ClauseInitial[] = [];

  for (let i = 0; i < snapshot.length; i++) {
    const entry = (initials as Record<string, unknown>[]).find((c) => c && c.clauseIndex === i);
    const value = entry?.initials;

    if (!entry || typeof value !== "string" || value.trim().length === 0) {
      return { error: `Clause ${i + 1} is missing initials`, field: `clauseInitials.${i}` };
    }

    normalized.push({ clauseIndex: i, initials: value.trim() });
  }

  return { value: normalized };
}
