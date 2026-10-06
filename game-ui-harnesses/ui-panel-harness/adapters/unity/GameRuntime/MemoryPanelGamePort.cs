using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;

namespace GameUi.PanelHarness.GameBinding
{
    public sealed class PanelGameCommandContext
    {
        private readonly MemoryPanelGamePort port;
        public CancellationToken Cancellation { get; private set; }
        public string InstanceId { get; private set; }
        internal PanelGameCommandContext(MemoryPanelGamePort owner, string instanceId, CancellationToken cancellation)
        { port = owner; InstanceId = instanceId; Cancellation = cancellation; }
        public IReadOnlyDictionary<string, object> GetSnapshot() { Cancellation.ThrowIfCancellationRequested(); return port.GetSnapshot(); }
        public void Update(IReadOnlyDictionary<string, object> patch) { Cancellation.ThrowIfCancellationRequested(); port.Update(patch); }
    }
    public sealed class MemoryPanelGamePort : IPanelGamePort, IDisposable
    {
        public delegate Task Command(PanelGameCommandContext context, IReadOnlyDictionary<string, object> payload);
        private sealed class Request { public string command; public CancellationTokenSource cancellation; }
        private sealed class Subscription : IDisposable
        {
            private Action detach;
            public Subscription(Action action) { detach = action; }
            public void Dispose() { Action action = detach; detach = null; action?.Invoke(); }
        }
        private readonly int thread = Thread.CurrentThread.ManagedThreadId;
        private readonly Action<IReadOnlyDictionary<string, object>> validate;
        private readonly Action<Exception> listenerError;
        private readonly Dictionary<string, Command> commands;
        private readonly List<Action<IReadOnlyDictionary<string, object>>> listeners = new List<Action<IReadOnlyDictionary<string, object>>>();
        private readonly List<Request> requests = new List<Request>();
        private Dictionary<string, object> state;
        public bool Alive { get; private set; } = true;
        public int Subscribers { get { RequireThread(); return listeners.Count; } }
        public int Pending { get { RequireThread(); return requests.Count(request => !request.cancellation.IsCancellationRequested); } }
        public MemoryPanelGamePort(IReadOnlyDictionary<string, object> initialState, Action<IReadOnlyDictionary<string, object>> validator = null,
            IReadOnlyDictionary<string, Command> handlers = null, Action<Exception> onListenerError = null)
        {
            state = Copy(initialState); validate = validator ?? (_ => { }); listenerError = onListenerError;
            commands = handlers == null ? new Dictionary<string, Command>(StringComparer.Ordinal) : handlers.ToDictionary(pair => pair.Key, pair => pair.Value, StringComparer.Ordinal);
            validate(Snapshot(state));
        }
        private void RequireThread() { if (Thread.CurrentThread.ManagedThreadId != thread) throw new PanelGameException("GAME_MAIN_THREAD_REQUIRED"); }
        private void RequireAlive() { RequireThread(); if (!Alive) throw new ObjectDisposedException("MemoryPanelGamePort"); }
        private static Dictionary<string, object> Copy(IReadOnlyDictionary<string, object> input)
        {
            if (input == null || input.Any(pair => string.IsNullOrEmpty(pair.Key) || !(pair.Value is double || pair.Value is bool || pair.Value is string)
                || (pair.Value is double && (double.IsNaN((double)pair.Value) || double.IsInfinity((double)pair.Value))))) throw new PanelGameException("GAME_PORT_STATE");
            return input.ToDictionary(pair => pair.Key, pair => pair.Value, StringComparer.Ordinal);
        }
        private static IReadOnlyDictionary<string, object> Snapshot(Dictionary<string, object> input)
        { return new ReadOnlyDictionary<string, object>(new Dictionary<string, object>(input, StringComparer.Ordinal)); }
        public IReadOnlyDictionary<string, object> GetSnapshot() { RequireAlive(); return Snapshot(state); }
        public IDisposable Subscribe(Action<IReadOnlyDictionary<string, object>> listener)
        {
            RequireAlive(); if (listener == null) throw new ArgumentNullException(nameof(listener));
            listeners.Add(listener); return new Subscription(() => { RequireThread(); listeners.Remove(listener); });
        }
        public void Update(IReadOnlyDictionary<string, object> patch)
        {
            RequireAlive(); Dictionary<string, object> values = Copy(patch), next = new Dictionary<string, object>(state, StringComparer.Ordinal);
            foreach (KeyValuePair<string, object> pair in values)
            { if (!next.ContainsKey(pair.Key)) throw new PanelGameException("GAME_PORT_STATE_KEY"); next[pair.Key] = pair.Value; }
            validate(Snapshot(next)); state = next;
            foreach (Action<IReadOnlyDictionary<string, object>> listener in listeners.ToArray())
                try { listener(Snapshot(state)); } catch (Exception exception) { try { listenerError?.Invoke(exception); } catch { } }
        }
        public async Task ExecuteAsync(string command, IReadOnlyDictionary<string, object> payload, string instanceId, CancellationToken cancellation)
        {
            RequireAlive(); Command handler;
            if (command == null || !commands.TryGetValue(command, out handler) || handler == null) throw new PanelGameException("GAME_COMMAND_UNKNOWN");
            IReadOnlyDictionary<string, object> copy = Snapshot(Copy(payload));
            Request request = new Request { command = command, cancellation = CancellationTokenSource.CreateLinkedTokenSource(cancellation) };
            requests.Add(request);
            try
            {
                request.cancellation.Token.ThrowIfCancellationRequested();
                await handler(new PanelGameCommandContext(this, instanceId, request.cancellation.Token), copy);
                RequireAlive(); request.cancellation.Token.ThrowIfCancellationRequested();
            }
            finally { RequireThread(); requests.Remove(request); request.cancellation.Dispose(); }
        }
        public void Cancel(string command)
        { RequireAlive(); foreach (Request request in requests.Where(item => item.command == command).ToArray()) request.cancellation.Cancel(); }
        public void Dispose()
        {
            RequireThread(); if (!Alive) return; Alive = false; listeners.Clear();
            foreach (Request request in requests.ToArray()) request.cancellation.Cancel();
        }
    }
}
