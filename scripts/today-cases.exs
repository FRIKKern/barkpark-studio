# Answers fixtures/today-cases.json's cases with Barkpark's own "$today" code
# (api/lib/barkpark/content/today.ex), so the studio's resolver (app/src/lib/today-start.ts)
# can be checked against them (today-server.test.ts). Runs that one module alone under elixir, with the
# `tz` zone database Barkpark uses: no server, no database.
#   elixir scripts/today-cases.exs <barkpark checkout>
# then commit the rewritten fixture. The "server" line says which barkpark commit answered.
Mix.install([{:tz, "~> 0.28"}, {:jason, "~> 1.4"}])
[barkpark] = System.argv()
Code.require_file(Path.join(barkpark, "api/lib/barkpark/content/today.ex"))
{sha, 0} = System.cmd("git", ["-C", barkpark, "rev-parse", "--short=10", "HEAD"])
path = Path.join(__DIR__, "../fixtures/today-cases.json")
fixture = JSON.decode!(File.read!(path))
cases =
  for %{"name" => name, "now" => now, "zone" => zone, "value" => value} <- fixture["cases"] do
    {:ok, at, 0} = DateTime.from_iso8601(now)
    # zone null: a workspace with no zone, which Today.clock/2 reads as "Etc/UTC".
    clock = %{now: at, zone: zone || "Etc/UTC"}
    Jason.OrderedObject.new([{"name", name}, {"now", now}, {"zone", zone}, {"value", value}, {"server", Barkpark.Content.Today.resolve(value, clock)}])
  end
out = Jason.OrderedObject.new([{"about", fixture["about"]}, {"server", "barkpark #{String.trim(sha)}"}, {"cases", cases}])
File.write!(path, Jason.encode!(out, pretty: true) <> "\n")
