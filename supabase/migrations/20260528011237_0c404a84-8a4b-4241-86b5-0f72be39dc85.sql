
-- 1. Corrigir search_path da função touch_updated_at
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $function$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$function$;

-- 2. Função auxiliar: verifica se o usuário autenticado é dono da apresentação
CREATE OR REPLACE FUNCTION public.is_presentation_owner(_presentation_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.presentations
    WHERE id = _presentation_id
      AND user_id = auth.uid()
  )
$$;

-- 3. events: substituir open_all por leitura pública + escrita restrita ao dono
DROP POLICY IF EXISTS open_all ON public.events;

CREATE POLICY "events_select_public"
  ON public.events FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "events_insert_owner"
  ON public.events FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "events_update_owner"
  ON public.events FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "events_delete_owner"
  ON public.events FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- 4. presentations: mesma estratégia
DROP POLICY IF EXISTS open_all ON public.presentations;

CREATE POLICY "presentations_select_public"
  ON public.presentations FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "presentations_insert_owner"
  ON public.presentations FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "presentations_update_owner"
  ON public.presentations FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "presentations_delete_owner"
  ON public.presentations FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- 5. questions: leitura pública (necessária para a tela do participante hoje);
--    escrita restrita ao dono da apresentação associada
DROP POLICY IF EXISTS open_all ON public.questions;

CREATE POLICY "questions_select_public"
  ON public.questions FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "questions_insert_owner"
  ON public.questions FOR INSERT
  TO authenticated
  WITH CHECK (public.is_presentation_owner(presentation_id));

CREATE POLICY "questions_update_owner"
  ON public.questions FOR UPDATE
  TO authenticated
  USING (public.is_presentation_owner(presentation_id))
  WITH CHECK (public.is_presentation_owner(presentation_id));

CREATE POLICY "questions_delete_owner"
  ON public.questions FOR DELETE
  TO authenticated
  USING (public.is_presentation_owner(presentation_id));

-- 6. Storage: bucket presentations — restringir escrita a usuários autenticados
--    e remover listagem ampla (acesso público continua via URL direta /object/public/)
DROP POLICY IF EXISTS presentations_public_read ON storage.objects;
DROP POLICY IF EXISTS presentations_public_insert ON storage.objects;
DROP POLICY IF EXISTS presentations_public_update ON storage.objects;
DROP POLICY IF EXISTS presentations_public_delete ON storage.objects;

CREATE POLICY "presentations_authenticated_read"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'presentations');

CREATE POLICY "presentations_authenticated_insert"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'presentations');

CREATE POLICY "presentations_authenticated_update"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'presentations')
  WITH CHECK (bucket_id = 'presentations');

CREATE POLICY "presentations_authenticated_delete"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'presentations');
