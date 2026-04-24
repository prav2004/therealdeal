"""Inspect ESPN summary for play-by-play and at-bat data"""
import json

import requests

r = requests.get('https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard')
data = r.json()
events = data.get('events', [])

# Find a live or recent game
event_id = None
for ev in events:
    status = ev.get('status', {}).get('type', {})
    state = status.get('state', '')
    print(f"  {ev.get('shortName')} state={state}")
    if state == 'in':
        event_id = ev.get('id')
        break
if not event_id:
    # Use first game
    event_id = events[0].get('id')
    print(f"No live game, using first: {events[0].get('shortName')}")

print(f"\nUsing event {event_id}")

summary = requests.get(f'https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/summary?event={event_id}')
s = summary.json()

# Check plays
plays = s.get('plays', [])
print(f"\n=== PLAYS ({len(plays)}) ===")
for p in plays[-5:]:  # Last 5 plays
    print(f"\n  keys: {list(p.keys())}")
    print(f"  type: {p.get('type', {}).get('text', '?')}")
    print(f"  text: {p.get('text', '')[:120]}")
    print(f"  shortText: {p.get('shortText', '')[:80]}")
    print(f"  period: {p.get('period', {})}")
    if 'pitchData' in p:
        pd = p['pitchData']
        print(f"  pitchData keys: {list(pd.keys())}")
        print(f"  pitchData: {json.dumps(pd)[:200]}")
    if 'hitData' in p:
        hd = p['hitData']
        print(f"  hitData keys: {list(hd.keys())}")
        print(f"  hitData: {json.dumps(hd)[:200]}")
    if 'coordinate' in p:
        print(f"  coordinate: {p['coordinate']}")
    if 'wallclock' in p:
        print(f"  wallclock: {p['wallclock']}")
    if 'scoringPlay' in p:
        print(f"  scoringPlay: {p['scoringPlay']}")
    if 'atBatId' in p:
        print(f"  atBatId: {p['atBatId']}")

# Check atBats
atBats = s.get('atBats', [])
print(f"\n=== AT BATS ({len(atBats)}) ===")
for ab in atBats[-3:]:  # Last 3 at-bats
    print(f"\n  keys: {list(ab.keys())}")
    print(f"  id: {ab.get('id')}")
    if 'batter' in ab:
        print(f"  batter: {ab['batter'].get('displayName', '?')}")
    if 'pitcher' in ab:
        print(f"  pitcher: {ab['pitcher'].get('displayName', '?')}")
    if 'result' in ab:
        print(f"  result: {ab['result']}")
    if 'plays' in ab:
        abplays = ab['plays']
        print(f"  plays ({len(abplays)}):")
        for ap in abplays[-3:]:
            print(f"    text: {ap.get('text', '')[:100]}")
            if 'pitchData' in ap:
                pd = ap['pitchData']
                print(f"    pitchData: zone={pd.get('zone','')} type={pd.get('type',{}).get('text','')} speed={pd.get('speed','')} call={pd.get('call',{}).get('description','')}")
                if 'coordinate' in pd:
                    print(f"    pitchCoord: {pd['coordinate']}")
            if 'hitData' in ap:
                hd = ap['hitData']
                print(f"    hitData: type={hd.get('type','')} dist={hd.get('totalDistance','')} exitVelo={hd.get('exitVelocity','')} launchAngle={hd.get('launchAngle','')}")
                if 'coordinate' in hd:
                    print(f"    hitCoord: {hd['coordinate']}")

# Check playsMap
playsMap = s.get('playsMap', {})
print(f"\n=== PLAYS MAP keys: {list(playsMap.keys())[:10]} (total: {len(playsMap)}) ===")
if playsMap:
    first_key = list(playsMap.keys())[0]
    first_val = playsMap[first_key]
    print(f"  Sample key={first_key}")
    if isinstance(first_val, list):
        print(f"  Value is list of {len(first_val)}")
        if first_val:
            print(f"    First item keys: {list(first_val[0].keys()) if isinstance(first_val[0], dict) else type(first_val[0])}")

# Check situation
sit = s.get('situation', {})
if sit:
    print(f"\n=== SITUATION ===")
    print(f"  keys: {list(sit.keys())}")
    if 'lastPlay' in sit:
        lp = sit['lastPlay']
        print(f"  lastPlay keys: {list(lp.keys())}")
        print(f"  lastPlay text: {lp.get('text', '')[:120]}")
        if 'pitchData' in lp:
            print(f"  lastPlay pitchData: {json.dumps(lp['pitchData'])[:200]}")

print("\n=== DONE ===")
