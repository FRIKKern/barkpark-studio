# Answers fixtures/fixed-document-cases.json's cases with Barkpark's own rule for a type with a
# fixed set of documents (api/lib/barkpark/content/fixed_documents.ex, FixedDocuments.answer/4),
# so the studio's offers (app/src/lib/fixed-documents.ts) can be checked against them
# (fixed-documents-server.test.ts). Runs that module alone under elixir: no server, no database.
#   elixir scripts/fixed-document-cases.exs <barkpark checkout>
# then commit the rewritten fixture. The "server" line says which barkpark commit answered.
[barkpark] = System.argv()
# The module's other functions call Barkpark.Content and Ecto, which are not loaded here.
Code.put_compiler_option(:no_warn_undefined, :all)
for f <- ~w(draft_id.ex fixed_documents.ex), do: Code.require_file(Path.join([barkpark, "api/lib/barkpark/content", f]))
{sha, 0} = System.cmd("git", ["-C", barkpark, "rev-parse", "--short=10", "HEAD"])
alias Barkpark.Content.FixedDocuments

defmodule Cases do
  # Written as the committed file is: two-space indent, each case on one line, keys in order.
  def write(path, about, server, cases) do
    rows = Enum.map_join(cases, ",\n", &("    " <> obj(&1)))
    File.write!(path, "{\n  \"about\": #{JSON.encode!(about)},\n  \"server\": #{JSON.encode!(server)},\n  \"cases\": [\n#{rows}\n  ]\n}\n")
  end

  defp obj(pairs), do: "{" <> Enum.map_join(pairs, ", ", fn {k, v} -> JSON.encode!(k) <> ": " <> JSON.encode!(v) end) <> "}"
end

path = Path.join(__DIR__, "../fixtures/fixed-document-cases.json")
fixture = JSON.decode!(File.read!(path))
keys = ~w(name fixed action id exists)

cases =
  for c <- fixture["cases"] do
    # Barkpark's doors: a duplicate is a create of a new id; an edit writes over a row that exists.
    action = if c["action"] == "delete", do: :delete, else: :create
    answer = FixedDocuments.answer(c["fixed"], action, c["id"], fn -> c["exists"] end)
    Enum.map(keys, &{&1, c[&1]}) ++ [{"server", Atom.to_string(answer)}] ++ if(c["gap"], do: [{"gap", c["gap"]}], else: [])
  end

Cases.write(path, fixture["about"], "barkpark #{String.trim(sha)}", cases)
