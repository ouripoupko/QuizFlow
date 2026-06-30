-- QuizFlow — Supabase Storage bucket for question images (spec §9).
-- Path convention: {quiz_id}/{question_id}/{uuid}-{original_filename}
-- Private bucket; images are served via short-lived signed URLs.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'question-images',
  'question-images',
  false,
  10485760,   -- 10 MB per file
  array['image/jpeg', 'image/png', 'image/gif', 'image/webp']
)
on conflict (id) do nothing;

-- ── Storage object policies ───────────────────────────────────────────────────
-- The first segment of the path is the quiz_id, so we can check ownership
-- by joining storage.objects → public.quizzes without extra columns.

create policy "quiz creator uploads question images"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'question-images'
    and exists (
      select 1 from public.quizzes q
      where q.id = (storage.foldername(name))[1]::uuid
        and q.creator_id = auth.uid()
    )
  );

-- Anyone who can see the quiz (creator or published) can view its images.
create policy "read images of visible quizzes"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'question-images'
    and exists (
      select 1 from public.quizzes q
      where q.id = (storage.foldername(name))[1]::uuid
        and (q.creator_id = auth.uid() or q.status = 'published')
    )
  );

create policy "quiz creator deletes question images"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'question-images'
    and exists (
      select 1 from public.quizzes q
      where q.id = (storage.foldername(name))[1]::uuid
        and q.creator_id = auth.uid()
    )
  );
