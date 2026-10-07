#if UNITY_EDITOR && PANEL_GAME_ACCEPTANCE
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using GameUi.PanelHarness.GameBinding;
using GameUi.PanelHarness.GameExamples;
using GameUi.PanelHarness.Hosting;
using UnityEditor;
using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.UI;

namespace GameUi.PanelHarness.Editor
{
    public static class PanelGameBindingSmoke
    {
        [Serializable] private sealed class Input { public string version; public Source[] instances; public Resource[] resources; }
        [Serializable] private sealed class Source { public string id, prefab; public PanelDocument document; public PanelGameBindingDocument binding; }
        [Serializable] private sealed class Resource { public string path, sha256; }
        [Serializable] private sealed class Check { public string name, status = "PASS"; }
        [Serializable] private sealed class Report
        {
            public string version = "0.1", status = "RUNNING", error = "";
            public bool playMode; public int instances, cycles, decodedResources, modelCalls, automaticRetries;
            public List<Check> checks = new List<Check>();
        }
        private sealed class Item
        {
            public Source source; public PanelInstanceHost host; public PanelGameBinding binding; public MemoryPanelGamePort port;
            public int events; public List<string> errors = new List<string>();
        }
        private static void Assert(bool condition, string code) { if (!condition) throw new PanelGameException("GAME_SMOKE_" + code); }
        private static Dictionary<string, object> Values(params object[] pairs)
        { var result = new Dictionary<string, object>(StringComparer.Ordinal); for (int i = 0; i < pairs.Length; i += 2) result.Add((string)pairs[i], pairs[i + 1]); return result; }
        private static PanelControl Row(Item item, string id) { return item.source.document.controls.Single(control => control.rowId == id); }
        private static GameObject Node(Item item, string id) { return item.host.Root.GetComponentsInChildren<Transform>(true).Single(transform => transform.name == id).gameObject; }
        private static void Reveal(Item item, PanelControl row)
        {
            foreach (PanelControl tabs in item.source.document.controls.Where(control => control.kind == "tabs"))
                for (int i = 0; i < tabs.contentIds.Length; i++)
                    if (Node(item, row.nodeId).transform.IsChildOf(Node(item, tabs.contentIds[i]).transform))
                        Assert(item.host.Controller.SetChoice(tabs.fieldId, item.source.document.fields.Single(field => field.id == tabs.fieldId).options[i].id), "REVEAL");
        }
        private static void Type(Item item, string id, string value) { PanelControl row = Row(item, id); Reveal(item, row); Node(item, row.nodeId).GetComponent<InputField>().text = value; }
        private static void Click(Item item, string id)
        {
            PanelControl row = Row(item, id); Reveal(item, row);
            ExecuteEvents.Execute(Node(item, row.nodeId), new BaseEventData(EventSystem.current), ExecuteEvents.submitHandler);
        }
        private static double Number(Item item, string field) { return item.host.Controller.GetState().Single(value => value.fieldId == field).numberValue; }
        private static string Text(Item item, string field) { return item.host.Controller.GetState().Single(value => value.fieldId == field).stringValue; }
        private static async Task Wait(Func<bool> ready)
        { for (int i = 0; i < 400 && !ready(); i++) await Task.Delay(10); Assert(ready(), "ASYNC_TIMEOUT"); }
        private static void Mount(Item item, Transform parent)
        {
            item.host = new PanelInstanceHost(item.source.id, AssetDatabase.LoadAssetAtPath<GameObject>(item.source.prefab), parent);
            item.host.EventRaised += (id, value) => { Assert(id == item.source.id, "INSTANCE_ID"); item.events++; };
            item.binding = new PanelGameBinding(item.host, item.source.document, item.source.binding, item.port);
            item.binding.Error += code => item.errors.Add(code);
        }
        private static void Reject(Action action, string code)
        { bool rejected = false; try { action(); } catch (PanelGameException exception) { rejected = exception.Code == code; } Assert(rejected, "REJECT_" + code); }
        public static async Task RunAsync(string kit)
        {
            Input input = JsonUtility.FromJson<Input>(File.ReadAllText(Path.GetFullPath(kit + "/game-instances.json"), Encoding.UTF8));
            Report report = new Report { playMode = Application.isPlaying, instances = input.instances.Length };
            Action<string> pass = name => report.checks.Add(new Check { name = name });
            var items = new List<Item>(); GameObject owner = new GameObject("GameBindingAcceptance");
            AudioSource music = new GameObject("MusicBus", typeof(AudioSource)).GetComponent<AudioSource>(); music.transform.SetParent(owner.transform); music.playOnAwake = false;
            AudioSource effects = new GameObject("EffectsBus", typeof(AudioSource)).GetComponent<AudioSource>(); effects.transform.SetParent(owner.transform); effects.playOnAwake = false;
            try
            {
                Assert(report.playMode && input.version == "0.1" && input.instances.Length == 5 && input.resources.Length == 2, "INPUT");
                var resources = input.resources.Select(resource => new PanelGameExamplePorts.Resource(File.ReadAllBytes(Path.GetFullPath(resource.path)), resource.sha256)).ToArray();
                foreach (Source source in input.instances)
                {
                    var item = new Item { source = source };
                    item.port = source.id == "settings" ? PanelGameExamplePorts.Audio(music, effects)
                        : source.id.StartsWith("role", StringComparison.Ordinal) ? PanelGameExamplePorts.Character(120) : PanelGameExamplePorts.Loading(resources, 100);
                    items.Add(item); Mount(item, owner.transform);
                    Assert(item.host.Controller.PanelSha256 == source.binding.panelSha256, "IDENTITY");
                }
                await Task.Delay(50);
                pass("five-original-native-ugui-prefabs-bind-to-independent-game-ports");
                Item audio = items.Single(item => item.source.id == "settings"), role = items.Single(item => item.source.id == "role"), copy = items.Single(item => item.source.id == "role-copy"), load = items.Single(item => item.source.id == "loading-a"), other = items.Single(item => item.source.id == "loading-b");
                PanelGameBindingDocument bad = JsonUtility.FromJson<PanelGameBindingDocument>(JsonUtility.ToJson(audio.source.binding)); bad.panelSha256 = new string('0', 64);
                Reject(() => new PanelGameBinding(audio.host, audio.source.document, bad, audio.port), "GAME_BINDING_SOURCE");
                bad = JsonUtility.FromJson<PanelGameBindingDocument>(JsonUtility.ToJson(load.source.binding)); bad.states[0].direction = "two-way";
                Reject(() => new PanelGameBinding(load.host, load.source.document, bad, load.port), "GAME_BINDING_PROGRESS");
                bad = JsonUtility.FromJson<PanelGameBindingDocument>(JsonUtility.ToJson(role.source.binding)); bad.commands[0].payload[0].fieldId = "missing";
                Reject(() => new PanelGameBinding(role.host, role.source.document, bad, role.port), "GAME_BINDING_PAYLOAD");
                pass("stale-digests-progress-directions-and-unknown-payload-fields-are-rejected");
                var invalid = new MemoryPanelGamePort(Values("volume", 101d, "musicVolume", 30d, "effectsVolume", 40d, "muted", false));
                string before = audio.host.Controller.GetStateJson();
                Reject(() => new PanelGameBinding(audio.host, audio.source.document, audio.source.binding, invalid), "GAME_STATE_REJECTED");
                Assert(invalid.Subscribers == 0 && before == audio.host.Controller.GetStateJson(), "ATOMIC_INITIAL"); invalid.Dispose();
                pass("invalid-initial-game-snapshot-is-atomic-and-creates-no-subscription");
                int events = audio.events; audio.port.Update(Values("volume", 40d));
                Assert(Number(audio, "row0") == 40 && audio.events == events && Math.Abs(music.volume - .12f) < 1e-5 && !music.isPlaying && !effects.isPlaying, "SILENT_AUDIO");
                pass("silent-game-push-updates-real-audio-source-gains-without-starting-playback");
                Reveal(audio, Row(audio, "row0")); Node(audio, Row(audio, "row0").nodeId).GetComponent<Slider>().value = 42;
                Assert((double)audio.port.GetSnapshot()["volume"] == 42d && Math.Abs(music.volume - .126f) < 1e-5, "NATIVE_SLIDER");
                Reveal(audio, Row(audio, "row3")); Node(audio, Row(audio, "row3").nodeId).GetComponent<Toggle>().isOn = true;
                Assert((bool)audio.port.GetSnapshot()["muted"] && music.mute && effects.mute, "NATIVE_MUTE");
                Click(audio, "row5"); Assert((double)audio.port.GetSnapshot()["volume"] == 70d && !music.mute && !effects.mute, "NATIVE_RESET");
                pass("native-slider-toggle-and-reset-write-only-explicit-game-targets");
                before = audio.host.Controller.GetStateJson(); Reject(() => audio.port.Update(Values("volume", 101d, "muted", true)), "GAME_VOLUME_INVALID");
                Assert(before == audio.host.Controller.GetStateJson() && (double)audio.port.GetSnapshot()["volume"] == 70d && !(bool)audio.port.GetSnapshot()["muted"], "PORT_ATOMIC");
                pass("rejected-game-update-preserves-the-complete-panel-and-business-state");
                Click(role, "row2"); Assert(role.binding.Inspect().Started == 0 && (double)role.port.GetSnapshot()["commits"] == 0d, "INVALID_FORM");
                Assert(await role.binding.RunAsync("row2") == "BLOCKED", "PROGRAMMATIC_FORM");
                pass("invalid-native-form-and-direct-command-are-blocked-before-business-work");
                Type(role, "row0", " 主角😀 "); Type(role, "row1", "你好\\\"玩家"); Type(copy, "row0", "主角乙");
                Click(role, "row2"); Click(role, "row2");
                await Wait(() => role.binding.Inspect().Pending == 0);
                Assert(role.binding.Inspect().Dropped == 1 && (double)role.port.GetSnapshot()["commits"] == 1d && (string)role.port.GetSnapshot()["savedName"] == " 主角😀 "
                    && (string)role.port.GetSnapshot()["savedDeclaration"] == "你好\\\"玩家" && (double)copy.port.GetSnapshot()["commits"] == 0d && Text(copy, "row0") == "主角乙", "EXACT_SUBMIT");
                pass("cross-page-native-submit-preserves-raw-unicode-and-drops-duplicate-pending-click");
                Type(role, "row0", "已存在"); Click(role, "row2"); await Wait(() => role.binding.Inspect().Pending == 0); await Task.Delay(160);
                Assert(role.binding.Inspect().Failed == 1 && role.binding.Inspect().Started == 2 && role.errors.SequenceEqual(new[] { "ROLE_NAME_EXISTS" })
                    && (string)role.port.GetSnapshot()["savedName"] == " 主角😀 " && Text(role, "row0") == "已存在", "REJECT_NO_RETRY");
                pass("async-business-rejection-preserves-draft-and-saved-record-with-no-automatic-retry");
                Type(role, "row0", "新角色"); Click(role, "row2"); await Wait(() => role.binding.Inspect().Pending == 0);
                Assert((double)role.port.GetSnapshot()["commits"] == 2d && role.binding.Inspect().LastError == null, "EXPLICIT_RETRY");
                pass("corrected-explicit-native-submit-recovers-after-rejection");
                Type(role, "row0", "待取消"); Click(role, "row2"); Click(role, "row3"); await Wait(() => role.binding.Inspect().Pending == 0);
                Assert((double)role.port.GetSnapshot()["commits"] == 2d && Text(role, "row0") == "待取消" && (string)role.port.GetSnapshot()["status"] == "CANCELLED", "CANCEL_ROLE");
                pass("native-cancel-aborts-submit-without-erasing-draft-or-committed-data");
                copy.binding.Dispose();
                var writeOnly = JsonUtility.FromJson<PanelGameBindingDocument>(JsonUtility.ToJson(copy.source.binding)); foreach (var route in writeOnly.states) route.direction = "to-game";
                copy.host.Controller.SetText("row0", "面板草稿"); copy.binding = new PanelGameBinding(copy.host, copy.source.document, writeOnly, copy.port);
                copy.port.Update(Values("draftName", "游戏草稿")); Assert(Text(copy, "row0") == "面板草稿", "TO_GAME_PUSH");
                Type(copy, "row0", "新面板草稿"); Assert((string)copy.port.GetSnapshot()["draftName"] == "新面板草稿", "TO_GAME_WRITE");
                copy.binding.Dispose(); copy.binding = new PanelGameBinding(copy.host, copy.source.document, copy.source.binding, copy.port);
                pass("to-game-route-keeps-panel-draft-and-sends-only-user-edits");
                Click(load, "row4"); Click(load, "row5"); await Wait(() => load.binding.Inspect().Pending == 0); await Task.Delay(240);
                Assert((double)load.port.GetSnapshot()["loadedBytes"] == 0d && (string)load.port.GetSnapshot()["status"] == "CANCELLED" && (string)other.port.GetSnapshot()["status"] == "IDLE", "CANCEL_LOAD");
                pass("native-loading-cancel-stops-work-without-affecting-the-other-loader");
                events = load.events; Click(load, "row4"); int afterClick = load.events; load.host.Close();
                await Wait(() => load.binding.Inspect().Pending == 0);
                Assert((string)load.port.GetSnapshot()["status"] == "COMPLETE" && Number(load, "row1") == 100d && (double)load.port.GetSnapshot()["loadedResources"] == 2d
                    && (double)load.port.GetSnapshot()["loadedBytes"] == resources.Sum(resource => (double)resource.Bytes.Length) && load.events == afterClick, "REAL_LOAD");
                load.host.Open(); Assert(Number(load, "row1") == 100d && load.events == afterClick, "REOPEN_PROGRESS"); report.decodedResources = 2;
                pass("two-sha256-verified-pngs-decode-while-closed-and-reopen-at-complete-progress");
                Click(load, "row4"); Click(load, "row4"); await Wait(() => load.binding.Inspect().Pending == 0);
                Assert((string)load.port.GetSnapshot()["status"] == "COMPLETE" && (double)load.port.GetSnapshot()["loadedResources"] == 2d && load.binding.Inspect().Cancelled >= 2, "REPLACE_LOAD");
                pass("replace-command-aborts-old-loader-without-clobbering-new-completion");
                Click(other, "row4"); other.binding.Dispose(); other.host.Dispose();
                await Wait(() => other.port.Pending == 0); Assert((string)other.port.GetSnapshot()["status"] == "CANCELLED", "DESTROY_LOAD");
                Mount(other, owner.transform); await Task.Delay(250);
                Assert(other.binding.Inspect().Started == 0 && other.port.Subscribers == 1 && (double)other.port.GetSnapshot()["loadedBytes"] == 0d, "REMOUNT_NO_RETRY");
                pass("binding-disposal-cancels-owned-work-and-remount-never-restarts-it");
                var gate = new TaskCompletionSource<bool>(); bool blockedLateWrite = false;
                var late = new MemoryPanelGamePort(Values("value", 0d), handlers: new Dictionary<string, MemoryPanelGamePort.Command> { { "slow", async (context, payload) => {
                    await gate.Task; try { context.Update(Values("value", 1d)); } catch (OperationCanceledException) { blockedLateWrite = true; throw; }
                } } });
                var cancellation = new CancellationTokenSource(); Task lateTask = late.ExecuteAsync("slow", Values(), "late", cancellation.Token);
                cancellation.Cancel(); gate.SetResult(true); try { await lateTask; } catch (OperationCanceledException) { }
                Assert(blockedLateWrite && (double)late.GetSnapshot()["value"] == 0d && late.Pending == 0, "LATE_WRITE"); cancellation.Dispose(); late.Dispose();
                pass("cancelled-command-context-refuses-late-game-commit-even-if-handler-ignored-token");
                int listenerErrors = 0, deliveries = 0;
                var memory = new MemoryPanelGamePort(Values("value", 0d), onListenerError: exception => listenerErrors++);
                var oldSnapshot = memory.GetSnapshot(); memory.Subscribe(snapshot => { throw new Exception("expected-listener-failure"); }); memory.Subscribe(snapshot => deliveries++);
                memory.Update(Values("value", 1d)); Assert(listenerErrors == 1 && deliveries == 1 && (double)oldSnapshot["value"] == 0d, "LISTENER_ISOLATION");
                Reject(() => memory.Update(Values("unknown", 2d)), "GAME_PORT_STATE_KEY"); Assert((double)memory.GetSnapshot()["value"] == 1d, "UNKNOWN_KEY_ATOMIC"); memory.Dispose();
                pass("game-snapshots-are-copied-listener-failures-isolated-and-unknown-writes-atomic");
                for (int cycle = 0; cycle < 10; cycle++)
                {
                    int[] counts = items.Select(item => item.events).ToArray();
                    foreach (Item item in items) item.host.Close(); audio.port.Update(Values("volume", 40d)); foreach (Item item in items) item.host.Open();
                    Assert(counts.SequenceEqual(items.Select(item => item.events)), "CLOSE_EVENTS");
                    foreach (Item item in items) { item.binding.Dispose(); item.host.Dispose(); Mount(item, owner.transform); }
                    Assert((double)role.port.GetSnapshot()["commits"] == 2d && Text(role, "row0") == "待取消" && Number(audio, "row0") == 40d
                        && items.All(item => item.port.Subscribers == (item == audio ? 2 : 1)), "CYCLE_STATE_AND_SUBSCRIPTIONS");
                    report.cycles++;
                }
                pass("ten-native-close-and-remount-cycles-retain-game-data-with-stable-subscriptions");
                copy.host.Dispose(); copy.port.Update(Values("draftName", "销毁后")); Assert(!copy.binding.Inspect().Alive && copy.port.Subscribers == 0, "AUTO_DETACH");
                pass("external-host-disposal-detaches-binding-on-the-next-game-notification");
                foreach (Item item in items) { item.binding.Dispose(); item.host.Dispose(); item.port.Dispose(); }
                await Task.Delay(30);
                Assert(items.All(item => !item.port.Alive && item.port.Pending == 0 && item.port.Subscribers == 0 && !item.binding.Inspect().Alive)
                    && owner.GetComponentsInChildren<PanelController>(true).Length == 0 && !music.isPlaying && !effects.isPlaying, "CLEANUP");
                Assert(items.Where(item => item != role).All(item => item.errors.Count == 0), "UNEXPECTED_BINDING_ERRORS");
                pass("final-disposal-removes-native-views-subscriptions-and-pending-work"); report.status = "PASS";
            }
            catch (Exception exception) { report.status = "FAIL"; report.error = exception is PanelGameException ? ((PanelGameException)exception).Code : "GAME_SMOKE_FAILED"; throw; }
            finally
            {
                foreach (Item item in items) { item.binding?.Dispose(); item.host?.Dispose(); item.port?.Dispose(); }
                UnityEngine.Object.Destroy(owner);
                File.WriteAllText(Path.GetFullPath("../unity-game-smoke.json"), JsonUtility.ToJson(report, true), new UTF8Encoding(false));
            }
        }
    }
}
#endif
