# Answers the condition case tables with Barkpark's own code, so the studio's rules can be
# checked against them:
#   fixtures/field-visibility-cases.json (conditions.ts, conditions-server.test.ts): ok / violated / skip
#   fixtures/cross-item-cases.json (cross-rules.ts item rules, cross-items-server.test.ts): the
#   findings' paths, or skip
# Runs Barkpark's two modules alone under elixir: no server, no database.
#   elixir scripts/field-visibility-cases.exs <barkpark checkout>
# then commit the rewritten fixtures. Each file keeps its layout and key order; only the
# answers and the "server" line (which barkpark commit answered) move.
[barkpark] = System.argv()
for f <- ~w(field_visibility.ex cross_validator.ex), do: Code.require_file(Path.join([barkpark, "api/lib/barkpark/content", f]))
{sha, 0} = System.cmd("git", ["-C", barkpark, "rev-parse", "--short=10", "HEAD"])
alias Barkpark.Content.CrossValidator

defmodule Cases do
  # JSON read with each object's keys in file order ({:obj, pairs}), and written back the way
  # the committed files are (Python's json.dumps(indent=1, ensure_ascii=False)).
  def read(path) do
    {term, _, ""} =
      JSON.decode(File.read!(path), nil,
        object_push: fn k, v, acc -> [{k, v} | acc] end,
        object_finish: fn acc, old -> {{:obj, Enum.reverse(acc)}, old} end
      )

    term
  end

  def plain({:obj, pairs}), do: Map.new(pairs, fn {k, v} -> {k, plain(v)} end)
  def plain(list) when is_list(list), do: Enum.map(list, &plain/1)
  def plain(v), do: v

  def get({:obj, pairs}, key), do: :proplists.get_value(key, pairs, nil)
  def put({:obj, pairs}, key, v), do: {:obj, List.keystore(pairs, key, 0, {key, v})}

  def write(path, term), do: File.write!(path, pretty(term, "") <> "\n")

  defp pretty({:obj, []}, _), do: "{}"
  defp pretty([], _), do: "[]"

  defp pretty({:obj, pairs}, ind),
    do: "{\n" <> Enum.map_join(pairs, ",\n", fn {k, v} -> ind <> " " <> JSON.encode!(k) <> ": " <> pretty(v, ind <> " ") end) <> "\n" <> ind <> "}"

  defp pretty(list, ind) when is_list(list),
    do: "[\n" <> Enum.map_join(list, ",\n", &(ind <> " " <> pretty(&1, ind <> " "))) <> "\n" <> ind <> "]"

  defp pretty(v, _), do: JSON.encode!(v)

  def answer(path, server, fun) do
    fixture = read(path)
    cases = for c <- get(fixture, "cases"), do: put(c, "server", fun.(c))
    write(path, fixture |> put("server", server) |> put("cases", cases))
  end
end

server = "barkpark #{String.trim(sha)}"
fixtures = Path.join(__DIR__, "../fixtures")

# A condition as the rule {name: r, rule, fields: [a]} on fields a n tags links obj ref d.
fields = for n <- ~w(a n tags links obj ref d), do: %{"name" => n}

Cases.answer(Path.join(fixtures, "field-visibility-cases.json"), server, fn c ->
  schema = %{"fields" => fields, "cross_validations" => [%{"name" => "r", "rule" => Cases.plain(Cases.get(c, "rule")), "fields" => ["a"]}]}
  {ok, _} = CrossValidator.partition(schema)
  v = CrossValidator.violations(%{"fields" => fields, "cross_validations" => ok}, Cases.plain(Cases.get(c, "doc")))
  if(ok == [], do: "skip", else: if(v == [], do: "ok", else: "violated"))
end)

# A whole rule (each, type, fields) on fields meny innhold tittel innstillinger: where it breaks.
item_fields = for n <- ~w(meny innhold tittel innstillinger), do: %{"name" => n}

Cases.answer(Path.join(fixtures, "cross-item-cases.json"), server, fn c ->
  schema = %{"fields" => item_fields, "cross_validations" => [Cases.plain(Cases.get(c, "rule"))]}

  case CrossValidator.partition(schema) do
    {[], _} -> "skip"
    {_, _} -> (fn %{errors: e, warnings: w} -> Enum.map(e ++ w, & &1.path) end).(CrossValidator.findings(schema, Cases.plain(Cases.get(c, "doc"))))
  end
end)
