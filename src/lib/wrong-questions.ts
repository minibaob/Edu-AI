import { ApiError, api } from "@/src/lib/api";
import type { GRADES, SUBJECTS } from "@/src/lib/options";

export const WRONG_QUESTION_SOURCES = ["作业", "考试", "练习", "资料"] as const;
export const WRONG_QUESTION_REASONS = ["概念不清", "计算失误", "审题不清", "方法不会", "粗心"] as const;
export const WRONG_QUESTION_STATUSES = {
  todo: "待复习", reviewing: "复习中", done: "已掌握",
} as const;

export type WrongQuestionStatus = keyof typeof WRONG_QUESTION_STATUSES;
export type WrongQuestionReason = (typeof WRONG_QUESTION_REASONS)[number];
export type WrongQuestionInput = {
  subject: (typeof SUBJECTS)[number];
  grade?: (typeof GRADES)[number] | null;
  chapter?: string | null;
  source: (typeof WRONG_QUESTION_SOURCES)[number];
  question: string;
  correct_answer: string;
  my_answer: string;
  reason: WrongQuestionReason;
  note?: string | null;
};
export type WrongQuestion = Omit<WrongQuestionInput, "grade" | "chapter" | "note"> & {
  id: string;
  user_id: string;
  grade: (typeof GRADES)[number] | null;
  chapter: string | null;
  note: string | null;
  status: WrongQuestionStatus;
  review_count: number;
  last_reviewed_at: string | null;
  visibility: "private" | "public";
  created_at: string;
};
// Public records deliberately have no identifier, owner or private answer.
export type PublicWrongQuestion = Pick<WrongQuestion, "subject" | "chapter" | "question" | "correct_answer" | "reason">;
export type WrongQuestionPatch = {
  status?: WrongQuestionStatus;
  reason?: WrongQuestionReason;
  note?: string | null;
} & ({ visibility?: "private"; public_confirmed?: never } | { visibility: "public"; public_confirmed: true });
export type WrongQuestionFilters = {
  subject?: string;
  chapter?: string;
  reason?: string;
  status?: WrongQuestionStatus | "";
  limit?: number;
  offset?: number;
};
export type WrongQuestionList = { user_id: string; items: WrongQuestion[]; total: number };
export type PublicWrongQuestionList = { items: PublicWrongQuestion[]; total: number };
export type WrongQuestionStats = { user_id: string; total: number; todo: number };
export type WrongQuestionResponse = { user_id: string; item: WrongQuestion };

function assertUser(data: { user_id: string } | null, userId: string): void {
  if (!data || typeof data.user_id !== "string") throw new ApiError("wrong_question_response_invalid", 503);
  if (data.user_id !== userId) throw new ApiError("wrong_question_session_changed", 409);
}

export function isWrongQuestionSessionError(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 401 || error.code === "wrong_question_session_changed");
}

// Uncertain responses may follow a committed write; never automatically replay.
export function isWrongQuestionWriteUncertain(error: unknown): boolean {
  if (!(error instanceof ApiError)) return true;
  return error.status === 0 || error.status >= 500 || error.code === "unknown" || error.code === "wrong_question_unconfirmed";
}

function query(filters: WrongQuestionFilters, publicOnly = false): string {
  const params = new URLSearchParams();
  for (const key of ["subject", "chapter", "reason"] as const) {
    if (filters[key]) params.set(key, filters[key]);
  }
  if (!publicOnly && filters.status) params.set("status", filters.status);
  params.set("limit", String(filters.limit ?? 20));
  params.set("offset", String(filters.offset ?? 0));
  return params.toString();
}

// Injectable request adapter keeps all traffic on the existing same-origin API.
export function createWrongQuestionsClient(request: typeof api = api) {
  const itemPath = (id: string) => `/api/wrong-questions/${encodeURIComponent(id)}`;
  const ownedItem = (data: WrongQuestionResponse, userId: string) => {
    assertUser(data, userId);
    assertUser(data.item, userId);
    return data;
  };
  return {
    async list(userId: string, filters: WrongQuestionFilters = {}) {
      const data = await request<WrongQuestionList>(`/api/wrong-questions?${query(filters)}`);
      assertUser(data, userId);
      if (!Array.isArray(data.items)) throw new ApiError("wrong_question_response_invalid", 503);
      data.items.forEach((item) => assertUser(item, userId));
      return data;
    },
    async publicList(filters: Omit<WrongQuestionFilters, "status"> = {}): Promise<PublicWrongQuestionList> {
      const data = await request<PublicWrongQuestionList>(`/api/wrong-questions/public?${query(filters, true)}`);
      if (!data || !Array.isArray(data.items)) throw new ApiError("wrong_question_response_invalid", 503);
      return {
        total: data.total,
        items: data.items.map(({ subject, chapter, question, correct_answer, reason }) =>
          ({ subject, chapter, question, correct_answer, reason })),
      };
    },
    async stats(userId: string) {
      const data = await request<WrongQuestionStats>("/api/wrong-questions/stats");
      assertUser(data, userId);
      return data;
    },
    async get(userId: string, id: string) {
      return ownedItem(await request<WrongQuestionResponse>(itemPath(id)), userId);
    },
    async create(userId: string, input: WrongQuestionInput) {
      return ownedItem(await request<WrongQuestionResponse>("/api/wrong-questions", {
        method: "POST", body: { ...input, expected_user_id: userId, visibility: "private" },
      }), userId);
    },
    async patch(userId: string, id: string, patch: WrongQuestionPatch) {
      return ownedItem(await request<WrongQuestionResponse>(itemPath(id), { method: "PATCH", body: patch }), userId);
    },
    async remove(id: string) {
      const data = await request<{ ok: true }>(itemPath(id), { method: "DELETE" });
      if (data?.ok !== true) throw new ApiError("wrong_question_unconfirmed", 503);
      return data;
    },
    async review(userId: string, id: string) {
      return ownedItem(await request<WrongQuestionResponse>(`${itemPath(id)}/review`, { method: "POST" }), userId);
    },
  };
}

export const wrongQuestionsClient = createWrongQuestionsClient();
