-- 1. Adiciona colunas de autorização
ALTER TABLE public.session_remotes
  ADD COLUMN IF NOT EXISTS user_id uuid,
  ADD COLUMN IF NOT EXISTS user_email text,
  ADD COLUMN IF NOT EXISTS presentation_id uuid,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS authorized_at timestamptz,
  ADD COLUMN IF NOT EXISTS denied_at timestamptz;

-- 2. Backfill: marca registros antigos como autorizados e preenche presentation_id
UPDATE public.session_remotes sr
SET presentation_id = s.presentation_id,
    status = COALESCE(NULLIF(sr.status, ''), 'authorized'),
    authorized_at = COALESCE(sr.authorized_at, sr.created_at)
FROM public.sessions s
WHERE sr.session_id = s.id
  AND (sr.presentation_id IS NULL OR sr.status = 'pending');

-- 3. Constraint de status
ALTER TABLE public.session_remotes
  DROP CONSTRAINT IF EXISTS session_remotes_status_check;
ALTER TABLE public.session_remotes
  ADD CONSTRAINT session_remotes_status_check
  CHECK (status IN ('pending', 'authorized', 'denied'));

-- 4. Índice para consultas por sessão+status
CREATE INDEX IF NOT EXISTS session_remotes_session_status_idx
  ON public.session_remotes (session_id, status);

-- 5. Função helper SECURITY DEFINER: verifica se o usuário autenticado
-- está autorizado como controle remoto para a sessão
CREATE OR REPLACE FUNCTION public.is_authorized_remote(_session_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.session_remotes
    WHERE session_id = _session_id
      AND user_id = auth.uid()
      AND status = 'authorized'
  );
$$;

-- 6. Substitui a política aberta por regras de autorização
DROP POLICY IF EXISTS open_all ON public.session_remotes;
DROP POLICY IF EXISTS session_remotes_select_public ON public.session_remotes;
DROP POLICY IF EXISTS session_remotes_insert_self ON public.session_remotes;
DROP POLICY IF EXISTS session_remotes_update_owner ON public.session_remotes;
DROP POLICY IF EXISTS session_remotes_delete_owner_or_self ON public.session_remotes;

-- Leitura pública: o celular precisa consultar o próprio status
CREATE POLICY session_remotes_select_public
ON public.session_remotes
FOR SELECT
TO anon, authenticated
USING (true);

-- Inserção: somente autenticados podem solicitar; sempre como 'pending' em seu próprio nome
CREATE POLICY session_remotes_insert_self
ON public.session_remotes
FOR INSERT
TO authenticated
WITH CHECK (
  user_id = auth.uid()
  AND status = 'pending'
  AND presentation_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM public.sessions s
    WHERE s.id = session_remotes.session_id
      AND s.presentation_id = session_remotes.presentation_id
  )
);

-- Update (autorizar/negar): somente o dono da apresentação
CREATE POLICY session_remotes_update_owner
ON public.session_remotes
FOR UPDATE
TO authenticated
USING (public.is_presentation_owner(presentation_id))
WITH CHECK (public.is_presentation_owner(presentation_id));

-- Delete: dono da apresentação ou o próprio usuário
CREATE POLICY session_remotes_delete_owner_or_self
ON public.session_remotes
FOR DELETE
TO authenticated
USING (
  public.is_presentation_owner(presentation_id)
  OR user_id = auth.uid()
);