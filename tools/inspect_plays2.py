"""Deep inspect ESPN plays data: pitchCoordinate, hitCoordinate, atBats"""
import json

import requests

r = requests.get('https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard')
data = r.json()
events = data.get('events', [])
event_id = None
for ev in events:
    state = ev.get('status', {}).get('type', {}).get('state', '')
    if state == 'in':
        event_id = ev.get('id')
        break
if not event_id:
    event_id = events[0].get('id')
print(f"Event: {event_id}")

summary = requests.get(f'https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/summary?event={event_id}')
s = summary.json()

plays = s.get('plays', [])
print(f"\n=== PLAYS WITH PITCH COORDS ({len(plays)} total) ===")
pitch_plays = [p for p in plays if p.get('pitchCoordinate')]
hit_plays = [p for p in plays if p.get('hitCoordinate')]
print(f"Plays with pitchCoordinate: {len(pitch_plays)}")
print(f"Plays with hitCoordinate: {len(hit_plays)}")

# Show some pitch coordinate examples
for p in pitch_plays[:5]:
    print(f"\n  type={p.get('type',{}).get('text','')}")
    print(f"  text={p.get('text','')[:100]}")
    print(f"  pitchCoordinate: {p.get('pitchCoordinate')}")
    print(f"  pitchType: {p.get('pitchType')}")
    print(f"  pitchVelocity: {p.get('pitchVelocity')}")
    print(f"  atBatId: {p.get('atBatId')}")

# Show hit coordinate examples
print(f"\n=== HIT COORDINATES ===")
for p in hit_plays[:5]:
    print(f"\n  type={p.get('type',{}).get('text','')}")
    print(f"  text={p.get('text','')[:100]}")
    print(f"  hitCoordinate: {p.get('hitCoordinate')}")
    print(f"  trajectory: {p.get('trajectory')}")
    print(f"  atBatId: {p.get('atBatId')}")

# Check atBats structure (it's a dict/map)
atBats = s.get('atBats', {})
print(f"\n=== AT BATS (type={type(atBats).__name__}) ===")
if isinstance(atBats, dict):
    print(f"Keys (first 5): {list(atBats.keys())[:5]}")
    first_key = list(atBats.keys())[0] if atBats else None
    if first_key:
        ab = atBats[first_key]
        print(f"\nSample atBat key={first_key}")
        print(f"  type: {type(ab).__name__}")
        if isinstance(ab, dict):
            print(f"  keys: {list(ab.keys())}")
        elif isinstance(ab, list):
            print(f"  length: {len(ab)}")
            if ab:
                print(f"  first item keys: {list(ab[0].keys()) if isinstance(ab[0], dict) else type(ab[0])}")
                item = ab[0]
                print(f"  first item: {json.dumps(item)[:300]}")
elif isinstance(atBats, list):
    print(f"Length: {len(atBats)}")
    if atBats:
        ab = atBats[-1]
        print(f"  keys: {list(ab.keys())}")

# Check playsMap
playsMap = s.get('playsMap', {})
print(f"\n=== PLAYS MAP (type={type(playsMap).__name__}, keys={len(playsMap)}) ===")
if isinstance(playsMap, dict) and playsMap:
    first_key = list(playsMap.keys())[0]
    val = playsMap[first_key]
    print(f"  Sample key: {first_key}")
    print(f"  Value type: {type(val).__name__}")
    if isinstance(val, list) and val:
        print(f"  List length: {len(val)}")
        print(f"  First item: {json.dumps(val[0])[:200]}")

# Check a full play with all data
print(f"\n=== SAMPLE FULL PLAYS (last 3 with pitch data) ===")
for p in pitch_plays[-3:]:
    print(f"\n  --- Play ---")
    print(f"  type: {p.get('type',{}).get('text','')}")
    print(f"  text: {p.get('text','')}")
    print(f"  atBatPitchNumber: {p.get('atBatPitchNumber')}")
    print(f"  pitchCoordinate: {p.get('pitchCoordinate')}")
    print(f"  pitchType: {p.get('pitchType')}")
    print(f"  pitchVelocity: {p.get('pitchVelocity')}")
    print(f"  pitchCount: {p.get('pitchCount')}")
    print(f"  resultCount: {p.get('resultCount')}")
    print(f"  period: {p.get('period',{}).get('displayValue','')}")
    print(f"  summaryType: {p.get('summaryType')}")
    print(f"  participants: {json.dumps(p.get('participants',[]))[:200]}")

print(f"\n=== DONE ===")
