import { ApiError, api } from "@/src/lib/api";

export type StudyTask = {
  id: string;
  user_id: string;
  title: string;
  subject: string | null;
  kind: "normal";
  due_date: string | null;
  done: boolean;
  done_at: string | null;
  created_at: string;
};
export type StudyTaskInput = {
  title: string;
  subject?: string | null;
  kind?: "normal";
  due_date?: string | null;
};
export type StudyTaskPatch = {
  title?: string;
  subject?: string | null;
  due_date?: string | null;
  done?: boolean;
};
export type StudyTaskList = { user_id: string; items: StudyTask[]; total: number };
export type StudyTaskResponse = { user_id: string; item: StudyTask };

function assertUser(data: { user_id: string } | null, userId: string): void {
  if (!data || typeof data.user_id !== "string") throw new ApiError("study_task_response_invalid", 503);
  if (data.user_id !== userId) throw new ApiError("study_task_session_changed", 409);
}

export function isStudyTaskSessionError(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 401 || error.code === "study_task_session_changed");
}

// Uncertain responses may follow a committed write; never automatically replay.
export function isStudyTaskWriteUncertain(error: unknown): boolean {
  if (!(error instanceof ApiError)) return true;
  return error.status === 0 || error.status >= 500 || error.code === "unknown" || error.code === "study_task_unconfirmed";
}

// Injectable request adapter keeps all traffic on the existing same-origin API.
export function createStudyTasksClient(request: typeof api = api) {
  const itemPath = (id: string) => `/api/study-tasks/${encodeURIComponent(id)}`;
  const ownedItem = (data: StudyTaskResponse, userId: string) => {
    assertUser(data, userId);
    assertUser(data.item, userId);
    return data;
  };
  return {
    async list(userId: string, filters: { limit?: number; offset?: number } = {}) {
      const params = new URLSearchParams();
      params.set("limit", String(filters.limit ?? 100));
      params.set("offset", String(filters.offset ?? 0));
      const data = await request<StudyTaskList>(`/api/study-tasks?${params}`);
      assertUser(data, userId);
      if (!Array.isArray(data.items)) throw new ApiError("study_task_response_invalid", 503);
      data.items.forEach((item) => assertUser(item, userId));
      return data;
    },
    async get(userId: string, id: string) {
      return ownedItem(await request<StudyTaskResponse>(itemPath(id)), userId);
    },
    async create(userId: string, input: StudyTaskInput) {
      return ownedItem(await request<StudyTaskResponse>("/api/study-tasks", {
        method: "POST", body: { ...input, expected_user_id: userId },
      }), userId);
    },
    async patch(userId: string, id: string, patch: StudyTaskPatch) {
      return ownedItem(await request<StudyTaskResponse>(itemPath(id), { method: "PATCH", body: patch }), userId);
    },
    async remove(id: string) {
      const data = await request<{ ok: true }>(itemPath(id), { method: "DELETE" });
      if (data?.ok !== true) throw new ApiError("study_task_unconfirmed", 503);
      return data;
    },
    async complete(userId: string, id: string) {
      return ownedItem(await request<StudyTaskResponse>(`${itemPath(id)}/complete`, { method: "POST" }), userId);
    },
  };
}

export const studyTasksClient = createStudyTasksClient();
