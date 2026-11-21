create function public.check_writer_save_and_print(p_actor uuid, p_data jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare
  draft jsonb;
  stock_number text := nullif(btrim(p_data->>'check_number'), '');
begin
  if stock_number is null or stock_number !~ '^[0-9]{1,12}$' or stock_number ~ '^0+$' then
    raise exception 'Enter the number from your check stock.';
  end if;

  draft := public.check_writer_change('save', p_actor, p_data)->0;
  if draft->>'status' is distinct from 'draft' then
    raise exception 'Only check drafts can be printed.';
  end if;

  return public.check_writer_change('print', p_actor, jsonb_build_object('items', jsonb_build_array(
    jsonb_build_object('id', draft->>'id', 'revision', draft->'revision', 'check_number', stock_number)
  )));
end;
$$;

revoke execute on function public.check_writer_save_and_print(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.check_writer_save_and_print(uuid, jsonb) to service_role;
