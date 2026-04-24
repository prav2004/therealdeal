import json
import sys
import urllib.request

url = "https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard"
resp = urllib.request.urlopen(url, timeout=10)
d = json.loads(resp.read())

events = d.get('events', [])
print(f"Total events: {len(events)}")

if not events:
    sys.exit(0)

ev = events[0]
comp = ev['competitions'][0]

print(f"\nGame: {ev.get('shortName','?')}")
print(f"\n=== COMPETITION KEYS ===")
print(sorted(comp.keys()))

# Probables (starting pitchers)
probables = comp.get('probables', [])
print(f"\n=== PROBABLES ({len(probables)}) ===")
for p in probables:
    ath = p.get('athlete', {})
    stats = p.get('statistics', [])
    print(f"  {ath.get('displayName','?')} #{ath.get('jersey','?')}")
    print(f"    headshot: {ath.get('headshot','N/A')[:80]}")
    for s in stats:
        print(f"    {s.get('name','?')} ({s.get('displayName','?')}): {s.get('displayValue','?')}")

# Competitor keys
home = [c for c in comp['competitors'] if c['homeAway'] == 'home'][0]
away = [c for c in comp['competitors'] if c['homeAway'] == 'away'][0]
print(f"\n=== COMPETITOR KEYS ===")
print(sorted(home.keys()))

# Leaders per team
for label, team in [('AWAY', away), ('HOME', home)]:
    leaders = team.get('leaders', [])
    print(f"\n=== {label} LEADERS ({len(leaders)} categories) ===")
    for cat in leaders:
        print(f"  Category: {cat.get('name','?')} ({cat.get('displayName','?')})")
        for l in cat.get('leaders', [])[:3]:
            a = l.get('athlete', {})
            print(f"    {a.get('displayName','?')} = {l.get('displayValue','?')}")

# Statistics per team
for label, team in [('AWAY', away), ('HOME', home)]:
    stats = team.get('statistics', [])
    print(f"\n=== {label} STATISTICS ({len(stats)}) ===")
    for s in stats[:10]:
        print(f"  {s}")

# Situation
sit = comp.get('situation')
if sit:
    print(f"\n=== SITUATION ===")
    print(json.dumps(sit, indent=2)[:2000])
else:
    print("\n=== NO SITUATION (game likely pre) ===")

# Event-level leaders
ev_leaders = ev.get('leaders', [])
print(f"\n=== EVENT LEADERS ({len(ev_leaders)} categories) ===")
for cat in ev_leaders:
    print(f"  {cat.get('name','?')} ({cat.get('displayName','?')})")
    for l in cat.get('leaders', [])[:2]:
        a = l.get('athlete', {})
        print(f"    {a.get('displayName','?')} = {l.get('displayValue','?')}")

# Check for any odds data related to starting pitchers
odds = comp.get('odds', [])
if odds:
    print(f"\n=== ODDS ({len(odds)}) ===")
    o = odds[0]
    print(f"  details: {o.get('details','?')}")
    print(f"  overUnder: {o.get('overUnder','?')}")
    ht = o.get('homeTeamOdds', {})
    at = o.get('awayTeamOdds', {})
    print(f"  homeML: {ht.get('moneyLine','?')}")
    print(f"  awayML: {at.get('moneyLine','?')}")
