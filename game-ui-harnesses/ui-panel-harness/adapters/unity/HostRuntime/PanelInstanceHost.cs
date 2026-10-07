using System;
using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.UI;

namespace GameUi.PanelHarness.Hosting
{
    // Optional game-side owner. Install once; all generated prefabs reuse it.
    public sealed class PanelInstanceHost : IDisposable
    {
        public const string VERSION = "0.1.0";
        private GameObject root;
        private PanelController controller;
        public string InstanceId { get; private set; }
        public GameObject Root { get { RequireAlive(); return root; } }
        public PanelController Controller { get { RequireAlive(); return controller; } }
        public bool IsOpen { get { return root != null && root.activeSelf; } }
        public event Action<string, PanelHostEvent> EventRaised;

        public PanelInstanceHost(string instanceId, GameObject prefab, Transform parent = null)
        {
            if (string.IsNullOrEmpty(instanceId) || prefab == null || prefab.GetComponent<PanelController>() == null)
                throw new ArgumentException("PANEL_HOST_INPUT");
            InstanceId = instanceId;
            root = UnityEngine.Object.Instantiate(prefab, parent);
            root.name = prefab.name;
            controller = root.GetComponent<PanelController>();
            controller.EventRaised += ForwardEvent;
        }

        private void RequireAlive() { if (root == null) throw new ObjectDisposedException("PanelInstanceHost"); }
        private void ForwardEvent(PanelHostEvent value) { EventRaised?.Invoke(InstanceId, value); }

        public void Open() { RequireAlive(); root.SetActive(true); }

        public void Close()
        {
            RequireAlive();
            EventSystem system = EventSystem.current;
            GameObject selected = system == null ? null : system.currentSelectedGameObject;
            if (selected != null && (selected == root || selected.transform.IsChildOf(root.transform)))
                system.SetSelectedGameObject(null);
            foreach (InputField input in root.GetComponentsInChildren<InputField>(true)) input.DeactivateInputField();
            root.SetActive(false);
        }

        // State stays on PanelController during Close/Open. A new owner starts
        // from the prefab's exported current values, independently of defaults.
        public void Dispose()
        {
            if (root == null) return;
            Close();
            controller.EventRaised -= ForwardEvent;
            EventRaised = null;
            UnityEngine.Object.Destroy(root);
            root = null;
            controller = null;
        }
    }
}
