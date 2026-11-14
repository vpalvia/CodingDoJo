---
description: Use when listing Unica listener, campaignweb, flowchart, platform, or ac_web log files updated in the last 15 minutes.
---

# Recent Unica logs

1. Call `list_recent_unica_logs` with `withinMinutes` set to 15, unless the user names a different number of minutes.
2. Read `files` and `notes`. Do not add files that are not in `files`.
3. Reply with one table: family, file name, path, partition, updated time, and age in minutes. Then list every note.
4. Order the rows as listener, campaignweb, flowchart, platform, then ac_web.
5. When `files` is empty, say that none of the five families were updated in the window, then repeat the notes.

## Where each family lives

- listener: `<UNICA_CAMPAIGN_HOME>/logs/unica_aclsnr.log` and rotations `unica_aclsnr.log.N`
- campaignweb: `<UNICA_CAMPAIGN_HOME>/logs/campaignweb.log` and rotations `campaignweb.log.N`
- flowchart: `<UNICA_CAMPAIGN_HOME>/partitions/<partition>/logs/<CampaignName>_<CampaignCode>_<FlowchartName>.log`
- ac_web: `<UNICA_CAMPAIGN_HOME>/partitions/<partition>/logs/ac_web.log` and rotations `ac_web.log.N`
- platform: `<UNICA_PLATFORM_HOME>/logs/platform.log` and rotations `platform.log.N`

On a listener cluster, flowchart and ac_web logs can also live under `UNICA_CAMPAIGN_SHARED_HOME/partitions/<partition>/logs`.

## Files this scan skips

`ETL.log`, `EngageETL.log`, `ImportError.log`, `UBX.log`, `masterlistener.log`, `unica_svradm.log`, `unica_acclean.log`, `ac_sess.log`, and `unica_acsesutil.log`.

## Configuration

The tool reads absolute paths from `UNICA_CAMPAIGN_HOME`, optional `UNICA_CAMPAIGN_SHARED_HOME`, and `UNICA_PLATFORM_HOME`. When a variable is unset, tell the user which families were not scanned.
