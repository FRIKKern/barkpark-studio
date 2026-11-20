# Answers fixtures/field-visibility-cases.json's cases with Barkpark's own code, so the studio's
# conditions (app/src/lib/conditions.ts) can be checked against them (conditions-server.test.ts).
# Runs Barkpark's two modules alone under elixir: no server, no database.
#   elixir scripts/field-visibility-cases.exs <barkpark checkout>
# then commit the rewritten fixture. The "server" line says which barkpark commit answered.
[barkpark] = System.argv()
for f <- ~w(field_visibility.ex cross_validator.ex), do: Code.require_file(Path.join([barkpark, "api/lib/barkpark/content", f]))
{sha, 0} = System.cmd("git", ["-C", barkpark, "rev-parse", "--short=10", "HEAD"])
path = Path.join(__DIR__, "../fixtures/field-visibility-cases.json")
fixture = JSON.decode!(File.read!(path))
fields = for n <- ~w(a n tags links obj ref d), do: %{"name" => n}
cases =
  for %{"name" => name, "rule" => rule, "doc" => doc} <- fixture["cases"] do
    schema = %{"fields" => fields, "cross_validations" => [%{"name" => "r", "rule" => rule, "fields" => ["a"]}]}
    {ok, _} = Barkpark.Content.CrossValidator.partition(schema)
    v = Barkpark.Content.CrossValidator.violations(%{"fields" => fields, "cross_validations" => ok}, doc)
    %{"name" => name, "rule" => rule, "doc" => doc, "server" => if(ok == [], do: "skip", else: if(v == [], do: "ok", else: "violated"))}
  end
File.write!(path, JSON.encode!(%{fixture | "server" => "barkpark #{String.trim(sha)}", "cases" => cases}) <> "\n")
