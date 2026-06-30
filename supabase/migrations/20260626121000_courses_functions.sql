-- ── course_dashboard ─────────────────────────────────────────────────────────
-- Returns one row per (quiz, student) pair for every quiz in the course,
-- aggregated across all sessions the student has ever participated in.
-- Only the course owner may call this (enforced inside the function body).
create function public.course_dashboard(_course_id uuid)
returns table (
  quiz_id          uuid,
  quiz_title       text,
  quiz_position    int,
  student_id       uuid,
  student_name     text,
  questions_total  bigint,
  questions_passed bigint,
  total_attempts   bigint,
  last_activity    timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select
    cq.quiz_id,
    q.title                                                                   as quiz_title,
    cq.position                                                               as quiz_position,
    sp.student_id,
    -- Most-recent display name the student used across sessions
    (array_agg(sp.display_name order by sp.joined_at desc))[1]               as student_name,
    -- Total questions in this quiz
    (select count(*) from questions qn where qn.quiz_id = cq.quiz_id)        as questions_total,
    -- Unique questions the student passed (at least one pass attempt)
    count(distinct case when r.decision = 'pass' then r.question_id end)     as questions_passed,
    -- Total answer submissions across all attempts
    count(r.id)                                                               as total_attempts,
    max(r.submitted_at)                                                       as last_activity
  from course_quizzes cq
  join quizzes q              on q.id  = cq.quiz_id
  join quiz_sessions s        on s.quiz_id = cq.quiz_id
  join session_participants sp on sp.session_id = s.id
                              and sp.student_id is not null
  left join responses r       on r.participant_id = sp.id
  where cq.course_id = _course_id
    -- Caller must own the course
    and exists (
      select 1 from courses c
      where c.id = _course_id and c.owner_id = auth.uid()
    )
  group by cq.quiz_id, q.title, cq.position, sp.student_id
  order by cq.position, student_name;
$$;

grant execute on function public.course_dashboard to authenticated;
