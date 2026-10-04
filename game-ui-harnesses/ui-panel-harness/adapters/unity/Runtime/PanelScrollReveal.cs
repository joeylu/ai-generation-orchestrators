using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.UI;

namespace GameUi.PanelHarness
{
    [DisallowMultipleComponent]
    public sealed class PanelScrollReveal : MonoBehaviour, ISelectHandler
    {
        [SerializeField] private ScrollRect scroll;
        private readonly Vector3[] CORNERS = new Vector3[4];

        public void Configure(ScrollRect owner) { scroll = owner; }

        public void OnSelect(BaseEventData eventData) { Reveal(); }

        public void Reveal()
        {
            RectTransform target = transform as RectTransform;
            if (scroll == null || scroll.content == null || scroll.viewport == null || target == null || !target.IsChildOf(scroll.content)) return;
            Canvas.ForceUpdateCanvases();
            RectTransform viewport = scroll.viewport;
            target.GetWorldCorners(CORNERS);
            float minimum = float.PositiveInfinity, maximum = float.NegativeInfinity;
            foreach (Vector3 corner in CORNERS)
            {
                float y = viewport.InverseTransformPoint(corner).y;
                minimum = Mathf.Min(minimum, y); maximum = Mathf.Max(maximum, y);
            }
            float delta = maximum > viewport.rect.yMax ? viewport.rect.yMax - maximum
                : minimum < viewport.rect.yMin ? viewport.rect.yMin - minimum : 0;
            if (Mathf.Approximately(delta, 0)) return;
            scroll.StopMovement();
            Vector2 position = scroll.content.anchoredPosition;
            float extent = Mathf.Max(0, scroll.content.rect.height - viewport.rect.height);
            position.y = Mathf.Clamp(position.y + delta, 0, extent);
            scroll.content.anchoredPosition = position;
        }
    }
}
