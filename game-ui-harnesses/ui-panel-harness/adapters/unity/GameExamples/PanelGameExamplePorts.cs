using System;
using System.Collections.Generic;
using System.Linq;
using System.Security.Cryptography;
using System.Threading;
using System.Threading.Tasks;
using GameUi.PanelHarness.GameBinding;
using UnityEngine;

namespace GameUi.PanelHarness.GameExamples
{
    // Local reference implementations. The game owns AudioSources, persistence and production loading.
    public static class PanelGameExamplePorts
    {
        public sealed class Resource
        {
            public byte[] Bytes { get; private set; }
            public string Sha256 { get; private set; }
            public Resource(byte[] bytes, string sha256) { Bytes = (byte[])bytes.Clone(); Sha256 = sha256; }
        }
        private static Dictionary<string, object> Values(params object[] pairs)
        {
            Dictionary<string, object> result = new Dictionary<string, object>(StringComparer.Ordinal);
            for (int i = 0; i < pairs.Length; i += 2) result.Add((string)pairs[i], pairs[i + 1]);
            return result;
        }
        private static void Percent(IReadOnlyDictionary<string, object> state, params string[] keys)
        {
            foreach (string key in keys)
                if (!(state[key] is double) || (double)state[key] < 0 || (double)state[key] > 100 || (double)state[key] != Math.Floor((double)state[key]))
                    throw new PanelGameException("GAME_VOLUME_INVALID");
        }
        public static MemoryPanelGamePort Audio(AudioSource music, AudioSource effects)
        {
            if (music == null || effects == null || music == effects) throw new PanelGameException("GAME_AUDIO_SOURCES");
            Action<IReadOnlyDictionary<string, object>> apply = state =>
            {
                if (music == null || effects == null) throw new PanelGameException("GAME_AUDIO_SOURCE_DESTROYED");
                music.volume = (float)((double)state["volume"] * (double)state["musicVolume"] / 10000);
                effects.volume = (float)((double)state["volume"] * (double)state["effectsVolume"] / 10000);
                music.mute = effects.mute = (bool)state["muted"];
            };
            MemoryPanelGamePort port = new MemoryPanelGamePort(Values("volume", 70d, "musicVolume", 30d, "effectsVolume", 40d, "muted", false), state =>
            {
                Percent(state, "volume", "musicVolume", "effectsVolume");
                if (!(state["muted"] is bool)) throw new PanelGameException("GAME_AUDIO_STATE");
            }, onListenerError: _ => { });
            apply(port.GetSnapshot()); port.Subscribe(apply); return port;
        }
        public static MemoryPanelGamePort Character(int delayMs = 100)
        {
            if (delayMs < 0) throw new ArgumentOutOfRangeException(nameof(delayMs));
            MemoryPanelGamePort port = null; int generation = 0;
            var handlers = new Dictionary<string, MemoryPanelGamePort.Command>(StringComparer.Ordinal);
            handlers.Add("profile.submit", async (context, payload) =>
            {
                string name = payload["name"] as string, declaration = payload["declaration"] as string;
                if (name == null || declaration == null || name.Trim().Length < 2 || !PanelController.StringValid(name, 12) || !PanelController.StringValid(declaration, 30))
                    throw new PanelGameException("ROLE_FORM_INVALID");
                int request = ++generation;
                context.Update(Values("status", "SAVING", "error", ""));
                try
                {
                    await Task.Delay(delayMs, context.Cancellation);
                    if (name == "已存在") { context.Update(Values("status", "FAILED", "error", "ROLE_NAME_EXISTS")); throw new PanelGameException("ROLE_NAME_EXISTS"); }
                    context.Update(Values("savedName", name, "savedDeclaration", declaration, "commits", (double)context.GetSnapshot()["commits"] + 1, "status", "COMPLETE", "error", ""));
                }
                catch (OperationCanceledException)
                {
                    if (port.Alive && request == generation) port.Update(Values("status", "CANCELLED"));
                    throw;
                }
            });
            handlers.Add("profile.cancel", (context, payload) => { ++generation; port.Cancel("profile.submit"); context.Update(Values("status", "CANCELLED")); return Task.CompletedTask; });
            port = new MemoryPanelGamePort(Values("draftName", "", "draftDeclaration", "", "savedName", "", "savedDeclaration", "", "commits", 0d, "status", "IDLE", "error", ""), state =>
            {
                if (!PanelController.StringValid(state["draftName"] as string, 12) || !PanelController.StringValid(state["draftDeclaration"] as string, 30)) throw new PanelGameException("ROLE_DRAFT_INVALID");
            }, handlers);
            return port;
        }
        public static MemoryPanelGamePort Loading(IEnumerable<Resource> inputs, int stepMs = 50)
        {
            if (inputs == null || stepMs < 0) throw new PanelGameException("GAME_LOADING_OPTIONS");
            Resource[] resources = inputs.Select(resource => new Resource(resource.Bytes, resource.Sha256)).ToArray();
            if (resources.Length == 0 || resources.Any(resource => resource.Bytes.Length == 0)) throw new PanelGameException("GAME_LOADING_RESOURCES");
            long total = resources.Sum(resource => (long)resource.Bytes.Length);
            MemoryPanelGamePort port = null; int generation = 0;
            var handlers = new Dictionary<string, MemoryPanelGamePort.Command>(StringComparer.Ordinal);
            handlers.Add("load.start", async (context, payload) =>
            {
                int request = ++generation; long loaded = 0; int count = 0;
                context.Update(Values("progress", 0d, "downloaded", 0d, "loadedResources", 0d, "loadedBytes", 0d, "status", "LOADING", "error", ""));
                try
                {
                    foreach (Resource resource in resources)
                    {
                        await Task.Delay(stepMs, context.Cancellation);
                        context.Cancellation.ThrowIfCancellationRequested();
                        string digest;
                        using (SHA256 hash = SHA256.Create()) digest = BitConverter.ToString(hash.ComputeHash(resource.Bytes)).Replace("-", "").ToLowerInvariant();
                        if (digest != resource.Sha256) throw new PanelGameException("GAME_RESOURCE_SHA256");
                        Texture2D texture = new Texture2D(2, 2);
                        try { if (!texture.LoadImage(resource.Bytes) || texture.width < 1 || texture.height < 1) throw new PanelGameException("GAME_RESOURCE_DECODE"); }
                        finally { UnityEngine.Object.Destroy(texture); }
                        loaded += resource.Bytes.Length; count++;
                        context.Update(Values("progress", (double)loaded / total * 100, "downloaded", (double)loaded / total * 250,
                            "loadedBytes", (double)loaded, "loadedResources", (double)count));
                    }
                    context.Update(Values("status", "COMPLETE"));
                }
                catch (OperationCanceledException) { if (port.Alive && request == generation) port.Update(Values("status", "CANCELLED")); throw; }
                catch (Exception exception)
                {
                    if (port.Alive && request == generation) port.Update(Values("status", "FAILED", "error", exception is PanelGameException ? ((PanelGameException)exception).Code : "GAME_LOAD_FAILED"));
                    throw;
                }
            });
            handlers.Add("load.cancel", (context, payload) => { ++generation; port.Cancel("load.start"); context.Update(Values("status", "CANCELLED")); return Task.CompletedTask; });
            port = new MemoryPanelGamePort(Values("progress", 25d, "downloaded", 50d, "promptSound", true, "loadedResources", 0d, "loadedBytes", 0d, "totalBytes", (double)total, "status", "IDLE", "error", ""), state =>
            {
                if (!(state["progress"] is double) || (double)state["progress"] < 0 || (double)state["progress"] > 100
                    || !(state["downloaded"] is double) || (double)state["downloaded"] < 0 || (double)state["downloaded"] > 250 || !(state["promptSound"] is bool)) throw new PanelGameException("GAME_LOADING_STATE");
            }, handlers);
            return port;
        }
    }
}
