using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using GameUi.PanelHarness.Hosting;
using UnityEngine;

namespace GameUi.PanelHarness.GameBinding
{
    // Native form of game-binding.schema.json. The deterministic exporter converts payload maps to arrays.
    [Serializable] public sealed class PanelGameBindingDocument
    {
        public string unityGameBindingVersion, panelId, panelSha256, sourceBindingSha256;
        public PanelGameStateRoute[] states;
        public PanelGameCommandRoute[] commands;
    }
    [Serializable] public sealed class PanelGameStateRoute { public string fieldId, key, direction; }
    [Serializable] public sealed class PanelGamePayloadRoute { public string key, fieldId; }
    [Serializable] public sealed class PanelGameCommandRoute
    {
        public string rowId, command, concurrency;
        public PanelGamePayloadRoute[] payload;
    }
    public interface IPanelGamePort
    {
        IReadOnlyDictionary<string, object> GetSnapshot();
        IDisposable Subscribe(Action<IReadOnlyDictionary<string, object>> listener);
        void Update(IReadOnlyDictionary<string, object> patch);
        Task ExecuteAsync(string command, IReadOnlyDictionary<string, object> payload, string instanceId, CancellationToken cancellation);
    }
    public sealed class PanelGameException : Exception
    {
        public string Code { get; private set; }
        public PanelGameException(string code) : base(code) { Code = code; }
    }
    public sealed class PanelGameBindingStatus
    {
        public bool Alive;
        public int Pending, Started, Completed, Failed, Cancelled, Dropped;
        public string LastError;
    }

    // One plain C# owner per instance. No Update, scene searches or generated component replacement.
    // All public calls and game-port notifications must run on Unity's main thread.
    public sealed class PanelGameBinding : IDisposable
    {
        public const string VERSION = "0.1.0";
        private readonly int thread = Thread.CurrentThread.ManagedThreadId;
        private readonly PanelInstanceHost host;
        private readonly PanelController controller;
        private readonly IPanelGamePort port;
        private readonly PanelGameBindingDocument binding;
        private readonly PanelDocument document;
        private readonly Dictionary<string, CancellationTokenSource> pending = new Dictionary<string, CancellationTokenSource>(StringComparer.Ordinal);
        private IDisposable subscription;
        private bool alive = true, syncing;
        private int started, completed, failed, cancelled, dropped;
        private string lastError;
        public event Action Changed;
        public event Action<string> Error;

        public PanelGameBinding(PanelInstanceHost instance, PanelDocument source, PanelGameBindingDocument routes, IPanelGamePort gamePort)
        {
            if (instance == null || source == null || routes == null || gamePort == null) throw new PanelGameException("GAME_BINDING_OPTIONS");
            host = instance; controller = instance.Controller; port = gamePort;
            document = JsonUtility.FromJson<PanelDocument>(JsonUtility.ToJson(source));
            binding = JsonUtility.FromJson<PanelGameBindingDocument>(JsonUtility.ToJson(routes));
            Validate();
            try
            {
                Synchronize(port.GetSnapshot()); // Validate a complete state before subscribing or writing game data.
                subscription = port.Subscribe(SnapshotChanged);
                if (subscription == null) throw new PanelGameException("GAME_PORT_SUBSCRIPTION");
                host.EventRaised += PanelChanged;
            }
            catch { Dispose(); throw; }
        }
        private static bool SafeKey(string value)
        {
            return value != null && Regex.IsMatch(value, "^[A-Za-z][A-Za-z0-9_.-]{0,63}$")
                && value != "__proto__" && value != "constructor" && value != "prototype";
        }
        private static bool Digest(string value) { return value != null && Regex.IsMatch(value, "^[a-f0-9]{64}$"); }
        private void Validate()
        {
            if (binding.unityGameBindingVersion != "0.1" || !Digest(binding.sourceBindingSha256) || !Digest(binding.panelSha256)
                || binding.panelId != controller.PanelId || binding.panelSha256 != controller.PanelSha256
                || document.panelId != controller.PanelId || document.panelSha256 != controller.PanelSha256)
                throw new PanelGameException("GAME_BINDING_SOURCE");
            if (binding.states == null || binding.commands == null || binding.states.Length > 128 || binding.commands.Length > 128
                || document.fields == null || document.controls == null) throw new PanelGameException("GAME_BINDING_LIMIT");
            Dictionary<string, PanelStateValue> fields = controller.GetState().ToDictionary(value => value.fieldId, StringComparer.Ordinal);
            if (document.fields.Length != fields.Count || document.fields.Any(field => field == null || !fields.ContainsKey(field.id) || fields[field.id].type != field.type))
                throw new PanelGameException("GAME_BINDING_SOURCE");
            HashSet<string> ids = new HashSet<string>(StringComparer.Ordinal), keys = new HashSet<string>(StringComparer.Ordinal);
            foreach (PanelGameStateRoute route in binding.states)
            {
                if (route == null || route.fieldId == null || !fields.ContainsKey(route.fieldId) || !ids.Add(route.fieldId) || !SafeKey(route.key) || !keys.Add(route.key)
                    || (route.direction != "two-way" && route.direction != "from-game" && route.direction != "to-game")) throw new PanelGameException("GAME_BINDING_STATE");
                if (fields[route.fieldId].type == "progress" && route.direction != "from-game") throw new PanelGameException("GAME_BINDING_PROGRESS");
            }
            ids.Clear();
            foreach (PanelGameCommandRoute route in binding.commands)
            {
                PanelControl row = route == null ? null : document.controls.FirstOrDefault(control => control.rowId == route.rowId);
                if (row == null || row.kind != "button" || !row.enabled || !ids.Add(row.rowId) || !SafeKey(route.command)
                    || (route.concurrency != "drop" && route.concurrency != "replace") || route.payload == null || route.payload.Length > 128)
                    throw new PanelGameException("GAME_BINDING_COMMAND");
                keys.Clear();
                foreach (PanelGamePayloadRoute payload in route.payload)
                    if (payload == null || !SafeKey(payload.key) || !keys.Add(payload.key) || payload.fieldId == null || !fields.ContainsKey(payload.fieldId)
                        || (row.action == "submit" && !row.submitFields.Contains(payload.fieldId))) throw new PanelGameException("GAME_BINDING_PAYLOAD");
            }
        }
        private void RequireThread() { if (Thread.CurrentThread.ManagedThreadId != thread) throw new PanelGameException("GAME_MAIN_THREAD_REQUIRED"); }
        private bool Live
        {
            get
            {
                if (!alive || controller == null) return false;
                try { return host.Controller == controller; } catch (ObjectDisposedException) { return false; }
            }
        }
        private static object Raw(PanelStateValue value)
        {
            if (value.type == "number" || value.type == "progress") return value.numberValue;
            if (value.type == "boolean") return value.booleanValue;
            return value.stringValue;
        }
        private static void Assign(PanelStateValue value, object raw)
        {
            if (value.type == "number" || value.type == "progress")
            {
                if (!(raw is double)) throw new PanelGameException("GAME_STATE_TYPE");
                value.numberValue = (double)raw;
            }
            else if (value.type == "boolean")
            {
                if (!(raw is bool)) throw new PanelGameException("GAME_STATE_TYPE");
                value.booleanValue = (bool)raw;
            }
            else
            {
                if (!(raw is string)) throw new PanelGameException("GAME_STATE_TYPE");
                value.stringValue = (string)raw;
            }
        }
        private void Synchronize(IReadOnlyDictionary<string, object> snapshot)
        {
            RequireThread();
            if (!Live) { Dispose(); return; }
            PanelStateValue[] values = controller.GetState();
            bool changed = false;
            foreach (PanelGameStateRoute route in binding.states)
            {
                if (route.direction == "to-game") continue;
                object raw;
                if (snapshot == null || !snapshot.TryGetValue(route.key, out raw)) throw new PanelGameException("GAME_PORT_STATE_KEY");
                PanelStateValue value = values.Single(item => item.fieldId == route.fieldId);
                changed |= !Equals(Raw(value), raw); Assign(value, raw);
            }
            if (!changed) return;
            syncing = true;
            try { if (!controller.SetState(values)) throw new PanelGameException("GAME_STATE_REJECTED"); }
            finally { syncing = false; }
        }
        private void SnapshotChanged(IReadOnlyDictionary<string, object> snapshot)
        {
            RequireThread(); if (syncing) return;
            try { Synchronize(snapshot); } catch (PanelGameException exception) { RecordError(exception.Code); }
            SignalChanged();
        }
        private void PanelChanged(string instanceId, PanelHostEvent value)
        {
            RequireThread();
            if (!Live) { Dispose(); return; }
            if (syncing || instanceId != host.InstanceId || value == null) return;
            PanelControl row = document.controls.FirstOrDefault(control => control.rowId == value.RowId && control.eventName == value.Name);
            if (row == null) return;
            try
            {
                Dictionary<string, object> values = controller.GetState().ToDictionary(item => item.fieldId, Raw, StringComparer.Ordinal);
                string[] changed = !string.IsNullOrEmpty(value.FieldId) ? new[] { value.FieldId }
                    : value.Action == "reset-initial" ? row.resetFields : new string[0];
                Dictionary<string, object> patch = binding.states.Where(route => route.direction != "from-game" && changed.Contains(route.fieldId))
                    .ToDictionary(route => route.key, route => values[route.fieldId], StringComparer.Ordinal);
                if (patch.Count > 0) port.Update(patch);
                PanelGameCommandRoute command = binding.commands.FirstOrDefault(route => route.rowId == row.rowId);
                if (command != null && value.Action == row.action) _ = ExecuteAsync(command);
            }
            catch (Exception exception) { RecordError(Code(exception, "GAME_STATE_WRITE_FAILED")); }
            SignalChanged();
        }
        public Task<string> RunAsync(string rowId)
        {
            RequireThread();
            if (!Live) { Dispose(); throw new ObjectDisposedException("PanelGameBinding"); }
            PanelGameCommandRoute route = binding.commands.FirstOrDefault(item => item.rowId == rowId);
            if (route == null) throw new PanelGameException("GAME_BINDING_COMMAND");
            return ExecuteAsync(route);
        }
        private async Task<string> ExecuteAsync(PanelGameCommandRoute route)
        {
            if (!Live) { Dispose(); return "DETACHED"; }
            PanelStateValue[] state = controller.GetState();
            PanelControl row = document.controls.Single(item => item.rowId == route.rowId);
            if (row.action == "submit" && row.submitFields.Any(id => PanelController.InputError(document.controls.Single(item => item.kind == "input" && item.fieldId == id), state.Single(item => item.fieldId == id).stringValue) != null))
                return "BLOCKED";
            CancellationTokenSource previous;
            if (pending.TryGetValue(route.rowId, out previous))
            {
                if (route.concurrency == "drop") { dropped++; SignalChanged(); return "DROPPED"; }
                previous.Cancel();
            }
            CancellationTokenSource request = new CancellationTokenSource();
            pending[route.rowId] = request; started++; SignalChanged();
            try
            {
                Dictionary<string, object> payload = route.payload.ToDictionary(item => item.key, item => Raw(state.Single(value => value.fieldId == item.fieldId)), StringComparer.Ordinal);
                await port.ExecuteAsync(route.command, payload, host.InstanceId, request.Token);
                RequireThread();
                if (!Live || request.IsCancellationRequested) { cancelled++; return "CANCELLED"; }
                completed++; lastError = null; return "COMPLETE";
            }
            catch (OperationCanceledException) { cancelled++; return "CANCELLED"; }
            catch (Exception exception)
            {
                if (!alive || request.IsCancellationRequested) { cancelled++; return "CANCELLED"; }
                failed++; RecordError(Code(exception, "GAME_COMMAND_FAILED")); return "FAILED";
            }
            finally
            {
                CancellationTokenSource current;
                if (pending.TryGetValue(route.rowId, out current) && current == request) pending.Remove(route.rowId);
                request.Dispose(); SignalChanged();
            }
        }
        private static string Code(Exception exception, string fallback)
        {
            PanelGameException game = exception as PanelGameException;
            return game != null && SafeKey(game.Code) ? game.Code : fallback;
        }
        private void RecordError(string code) { lastError = code; try { Error?.Invoke(code); } catch { } }
        private void SignalChanged() { try { Changed?.Invoke(); } catch { } }
        public PanelGameBindingStatus Inspect()
        {
            RequireThread();
            return new PanelGameBindingStatus { Alive = alive, Pending = pending.Count, Started = started, Completed = completed, Failed = failed, Cancelled = cancelled, Dropped = dropped, LastError = lastError };
        }
        public void Dispose()
        {
            RequireThread(); if (!alive) return; alive = false;
            host.EventRaised -= PanelChanged;
            IDisposable owned = subscription; subscription = null;
            try { owned?.Dispose(); }
            finally
            {
                CancellationTokenSource[] requests = pending.Values.ToArray(); pending.Clear();
                foreach (CancellationTokenSource request in requests) request.Cancel();
                Changed = null; Error = null;
            }
        }
    }
}
