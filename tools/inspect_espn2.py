import json
import sys
import urllib.request

url = "https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard"
resp = urllib.request.urlopen(url, timeout=10)
d = json.loads(resp.read())

events = d.get('events', [])

for ev in events[:3]:
    comp = ev['competitions'][0]
    home = [c for c in comp['competitors'] if c['homeAway'] == 'home'][0]
    away = [c for c in comp['competitors'] if c['homeAway'] == 'away'][0]
    
    print(f"\n{'='*60}")
    print(f"Game: {ev.get('shortName','?')}")
    
    # Check competitor-level probables
    for label, team in [('AWAY', away), ('HOME', home)]:
        probables = team.get('probables', [])
        print(f"\n  {label} PROBABLES ({len(probables)}):")
        for p in probables:
            ath = p.get('athlete', {})
            stats = p.get('statistics', [])
            print(f"    {ath.get('displayName','?')} #{ath.get('jersey','?')}")
            print(f"    headshot: {ath.get('headshot','N/A')[:80]}")
            print(f"    keys: {list(p.keys())}")
            for s in stats:
                print(f"      {s.get('name','?')} ({s.get('abbreviation','?')}): {s.get('displayValue','?')}")
            if not stats:
                print(f"      (no stats array)")
            # Check for any other interesting fields
            for k,v in p.items():
                if k not in ['athlete','statistics','playerId']:
                    print(f"      extra: {k}={v}")
    
    # Check leaders more deeply - get all leaders entries (not just top 1)
    for label, team in [('AWAY', away), ('HOME', home)]:
        leaders = team.get('leaders', [])
        print(f"\n  {label} LEADERS (all entries):")
        for cat in leaders:
            entries = cat.get('leaders', [])
            print(f"    {cat.get('displayName','?')} ({len(entries)} entries):")
            for l in entries[:5]:
                a = l.get('athlete', {})
                print(f"      {a.get('displayName','?')} = {l.get('displayValue','?')}  keys={list(l.keys())}")

    # Get team statistics with rankings
    for label, team in [('AWAY', away), ('HOME', home)]:
        stats = team.get('statistics', [])
        print(f"\n  {label} TEAM STATS:")
        for s in stats:
            print(f"    {s.get('name','?')} ({s.get('abbreviation','?')}): {s.get('displayValue','?')} rank={s.get('rankDisplayValue','?')}")
