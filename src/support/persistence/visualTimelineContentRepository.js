import { supabase } from "@/lib/supabaseClient";

const TABLE = "visual_timeline_private_content";

function assertAuthenticatedUser(session, userId) {
  if (!session?.user?.id || session.user.id !== userId) throw new Error("Sign in to save private timeline labels.");
}

export async function loadPrivateTimelineContent(userId, date) {
  const { data: auth, error: authError } = await supabase.auth.getSession();
  if (authError) throw authError;
  assertAuthenticatedUser(auth?.session, userId);
  const { data, error } = await supabase.from(TABLE).select("blocks").eq("user_id", userId).eq("timeline_date", date).maybeSingle();
  if (error) throw error;
  return Array.isArray(data?.blocks) ? data.blocks : [];
}

export async function savePrivateTimelineContent(userId, date, blocks) {
  const { data: auth, error: authError } = await supabase.auth.getSession();
  if (authError) throw authError;
  assertAuthenticatedUser(auth?.session, userId);
  const { error } = await supabase.from(TABLE).upsert({ user_id: userId, timeline_date: date, blocks, consented_at: new Date().toISOString(), updated_at: new Date().toISOString() }, { onConflict: "user_id,timeline_date" });
  if (error) throw error;
}

export async function deletePrivateTimelineContent(userId, date) {
  const { data: auth, error: authError } = await supabase.auth.getSession();
  if (authError) throw authError;
  assertAuthenticatedUser(auth?.session, userId);
  const { error } = await supabase.from(TABLE).delete().eq("user_id", userId).eq("timeline_date", date);
  if (error) throw error;
}
