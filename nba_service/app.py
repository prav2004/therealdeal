import time
from datetime import datetime, timezone

import requests
from flask import Flask, jsonify, request
from nba_api.live.nba.endpoints import scoreboard
from nba_api.stats.endpoints import (commonplayerinfo, commonteamroster,
                                     playercareerstats, playergamelog)

app = Flask(__name__)

CACHE = {}
DEFAULT_TTL = 90



def call_with_retries(fn, attempts=2, delay=1.0):
    last_err = None
    for _ in range(attempts):
        try:
            return fn(), None
        except Exception as exc:
            last_err = exc
            time.sleep(delay)
    return None, str(last_err)


def fetch_roster_from_cdn(team_id):
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
    }
    resp = requests.get("https://raw.githubusercontent.com/bttmly/nba/master/data/players.json", headers=headers, timeout=10)
    resp.raise_for_status()
    payload = resp.json()
    if isinstance(payload, list):
        players = payload
    else:
        players = payload.get("players") or payload.get("data") or payload.get("league", {}).get("standard", [])
    roster = []
    for p in players:
        if str(p.get("teamId")) != str(team_id):
            continue
        if p.get("isActive") is False:
            continue
        first = (p.get("firstName") or p.get("first_name") or "").strip()
        last = (p.get("lastName") or p.get("last_name") or "").strip()
        full = (p.get("full_name") or p.get("displayName") or p.get("name") or (first + " " + last).strip() or "Player")
        roster.append({
            "playerId": p.get("playerId") or p.get("personId") or p.get("id"),
            "fullName": full,
            "position": p.get("pos") or p.get("position") or "",
            "jersey": p.get("jersey") or "",
        })
    return roster


def cache_get(key):
    now = time.time()
    item = CACHE.get(key)
    if not item:
        return None
    expires_at, value = item
    if expires_at < now:
        CACHE.pop(key, None)
        return None
    return value


def cache_set(key, value, ttl=DEFAULT_TTL):
    CACHE[key] = (time.time() + ttl, value)


def current_season():
    now = datetime.now(timezone.utc)
    year = now.year
    if now.month >= 10:
        start = year
        end = year + 1
    else:
        start = year - 1
        end = year
    return f"{start}-{str(end)[-2:]}"


def extract_result_set(data, name):
    for rs in data.get("resultSets", []):
        if rs.get("name") == name:
            return rs
    return None


def row_to_dict(headers, row):
    return {headers[i]: row[i] for i in range(len(headers))}


@app.get("/health")
def health():
    return jsonify({"status": "ok"})


@app.get("/nba/today")
def nba_today():
    cached = cache_get("nba_today")
    if cached:
        return jsonify(cached)

    data = scoreboard.ScoreBoard().get_dict()
    games = data.get("scoreboard", {}).get("games", [])
    out = []
    for g in games:
        out.append({
            "gameId": g.get("gameId"),
            "gameTimeUTC": g.get("gameTimeUTC"),
            "statusText": g.get("gameStatusText"),
            "homeTeam": {
                "teamId": g.get("homeTeam", {}).get("teamId"),
                "teamName": g.get("homeTeam", {}).get("teamName"),
                "teamCity": g.get("homeTeam", {}).get("teamCity"),
                "teamTricode": g.get("homeTeam", {}).get("teamTricode"),
            },
            "awayTeam": {
                "teamId": g.get("awayTeam", {}).get("teamId"),
                "teamName": g.get("awayTeam", {}).get("teamName"),
                "teamCity": g.get("awayTeam", {}).get("teamCity"),
                "teamTricode": g.get("awayTeam", {}).get("teamTricode"),
            },
        })

    payload = {"games": out}
    cache_set("nba_today", payload, ttl=45)
    return jsonify(payload)


@app.get("/nba/roster")
def nba_roster():
    team_id = request.args.get("teamId")
    if not team_id:
        return jsonify({"error": "teamId is required"}), 400

    cache_key = f"roster:{team_id}:{current_season()}"
    cached = cache_get(cache_key)
    if cached:
        return jsonify(cached)

    season = current_season()
    players = []
    err = None
    try:
        players = fetch_roster_from_cdn(team_id)
    except Exception as exc:
        err = str(exc)

    if not players:
        roster, nba_err = call_with_retries(
            lambda: commonteamroster.CommonTeamRoster(team_id=team_id, season=season, timeout=10).get_dict()
        )
        if roster:
            rs = extract_result_set(roster, "CommonTeamRoster")
            if rs:
                headers = rs.get("headers", [])
                for row in rs.get("rowSet", []):
                    data = row_to_dict(headers, row)
                    players.append({
                        "playerId": data.get("PLAYER_ID"),
                        "fullName": data.get("PLAYER"),
                        "position": data.get("POSITION"),
                        "jersey": data.get("NUM"),
                    })
        if not players and nba_err:
            err = nba_err

    payload = {"players": players}
    if err and not players:
        payload["error"] = err
    cache_set(cache_key, payload, ttl=600)
    return jsonify(payload)


@app.get("/nba/player-stats")
def nba_player_stats():
    player_id = request.args.get("playerId")
    if not player_id:
        return jsonify({"error": "playerId is required"}), 400

    season = current_season()
    cache_key = f"stats:{player_id}:{season}"
    cached = cache_get(cache_key)
    if cached:
        return jsonify(cached)

    info, err = call_with_retries(
        lambda: commonplayerinfo.CommonPlayerInfo(player_id=player_id, timeout=10).get_dict()
    )
    if info is None:
        return jsonify({"error": err or "Player info unavailable"}), 502
    info_rs = extract_result_set(info, "CommonPlayerInfo")
    player_name = "Player"
    if info_rs and info_rs.get("rowSet"):
        row = row_to_dict(info_rs.get("headers", []), info_rs.get("rowSet", [])[0])
        player_name = row.get("DISPLAY_FIRST_LAST") or player_name

    totals, err = call_with_retries(
        lambda: playercareerstats.PlayerCareerStats(player_id=player_id, timeout=10).get_dict()
    )
    if totals is None:
        return jsonify({"error": err or "Career stats unavailable"}), 502
    totals_rs = extract_result_set(totals, "SeasonTotalsRegularSeason")
    totals_row = None
    if totals_rs:
        headers = totals_rs.get("headers", [])
        for row in totals_rs.get("rowSet", []):
            data = row_to_dict(headers, row)
            if data.get("SEASON_ID") == season:
                totals_row = data
                break
        if totals_row is None and totals_rs.get("rowSet"):
            totals_row = row_to_dict(headers, totals_rs.get("rowSet")[-1])

    season_totals = {
        "gp": totals_row.get("GP") if totals_row else None,
        "pts": totals_row.get("PTS") if totals_row else None,
        "reb": totals_row.get("REB") if totals_row else None,
        "ast": totals_row.get("AST") if totals_row else None,
    }

    per_game = {}
    if totals_row and totals_row.get("GP"):
        gp = totals_row.get("GP") or 0
        if gp:
            per_game = {
                "pts": round((totals_row.get("PTS") or 0) / gp, 1),
                "reb": round((totals_row.get("REB") or 0) / gp, 1),
                "ast": round((totals_row.get("AST") or 0) / gp, 1),
                "fg_pct": totals_row.get("FG_PCT"),
                "fg3_pct": totals_row.get("FG3_PCT"),
            }

    logs, err = call_with_retries(
        lambda: playergamelog.PlayerGameLog(player_id=player_id, season=season, timeout=10).get_dict()
    )
    if logs is None:
        logs = {}
    logs_rs = extract_result_set(logs, "PlayerGameLog")
    last5 = []
    if logs_rs:
        headers = logs_rs.get("headers", [])
        for row in logs_rs.get("rowSet", [])[:5]:
            data = row_to_dict(headers, row)
            last5.append({
                "date": data.get("GAME_DATE"),
                "matchup": data.get("MATCHUP"),
                "pts": data.get("PTS"),
                "reb": data.get("REB"),
                "ast": data.get("AST"),
            })

    payload = {
        "player": {"id": player_id, "name": player_name},
        "season": season,
        "seasonTotals": season_totals,
        "perGame": per_game,
        "last5": last5,
    }
    cache_set(cache_key, payload, ttl=300)
    return jsonify(payload)


if __name__ == "__main__":
    import os
    port = int(os.environ.get("PORT", "8080"))
    app.run(host="0.0.0.0", port=port, debug=False)
