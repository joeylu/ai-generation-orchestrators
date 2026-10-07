using UnityEngine;
using UnityEngine.UI;

namespace GameUi.PanelHarness
{
    [RequireComponent(typeof(CanvasRenderer))]
    public sealed class PanelRoundedGraphic : MaskableGraphic
    {
        private const int CORNER_SEGMENTS = 8;
        [SerializeField] private Color borderColor = Color.clear;
        [SerializeField] private float borderWidth;
        [SerializeField] private float cornerRadius;

        public void SetStyle(Color fill, Color border, float width, float radius)
        {
            color = fill;
            borderColor = border;
            borderWidth = Mathf.Max(0, width);
            cornerRadius = Mathf.Max(0, radius);
            SetVerticesDirty();
        }

        protected override void OnPopulateMesh(VertexHelper mesh)
        {
            mesh.Clear();
            Rect rect = GetPixelAdjustedRect();
            if (rect.width <= 0 || rect.height <= 0) return;
            float radius = Mathf.Min(cornerRadius, Mathf.Min(rect.width, rect.height) * 0.5f);
            float border = Mathf.Min(borderWidth, Mathf.Min(rect.width, rect.height) * 0.5f);
            if (border <= 0 || borderColor.a <= 0)
            {
                Fill(mesh, rect, radius, color);
                return;
            }
            Rect inner = Rect.MinMaxRect(rect.xMin + border, rect.yMin + border, rect.xMax - border, rect.yMax - border);
            if (inner.width <= 0 || inner.height <= 0) { Fill(mesh, rect, radius, borderColor); return; }
            Vector2[] outerPoints = Perimeter(rect, radius);
            Vector2[] innerPoints = Perimeter(inner, Mathf.Max(0, radius - border));
            Fill(mesh, inner, Mathf.Max(0, radius - border), color);
            int offset = mesh.currentVertCount;
            for (int index = 0; index < outerPoints.Length; index++)
            {
                AddVertex(mesh, outerPoints[index], borderColor);
                AddVertex(mesh, innerPoints[index], borderColor);
            }
            for (int index = 0; index < outerPoints.Length; index++)
            {
                int next = (index + 1) % outerPoints.Length;
                mesh.AddTriangle(offset + index * 2, offset + next * 2, offset + index * 2 + 1);
                mesh.AddTriangle(offset + next * 2, offset + next * 2 + 1, offset + index * 2 + 1);
            }
        }

        private static void Fill(VertexHelper mesh, Rect rect, float radius, Color tint)
        {
            if (tint.a <= 0) return;
            Vector2[] points = Perimeter(rect, radius);
            int offset = mesh.currentVertCount;
            AddVertex(mesh, rect.center, tint);
            foreach (Vector2 point in points) AddVertex(mesh, point, tint);
            for (int index = 0; index < points.Length; index++) mesh.AddTriangle(offset, offset + 1 + index, offset + 1 + (index + 1) % points.Length);
        }

        private static void AddVertex(VertexHelper mesh, Vector2 point, Color tint)
        {
            UIVertex vertex = UIVertex.simpleVert;
            vertex.position = point;
            vertex.color = tint;
            mesh.AddVert(vertex);
        }

        private static Vector2[] Perimeter(Rect rect, float radius)
        {
            Vector2[] centers = { new Vector2(rect.xMax - radius, rect.yMin + radius), new Vector2(rect.xMax - radius, rect.yMax - radius),
                new Vector2(rect.xMin + radius, rect.yMax - radius), new Vector2(rect.xMin + radius, rect.yMin + radius) };
            Vector2[] points = new Vector2[(CORNER_SEGMENTS + 1) * 4];
            for (int corner = 0; corner < 4; corner++)
            {
                for (int segment = 0; segment <= CORNER_SEGMENTS; segment++)
                {
                    float angle = (-90 + corner * 90 + segment * 90f / CORNER_SEGMENTS) * Mathf.Deg2Rad;
                    points[corner * (CORNER_SEGMENTS + 1) + segment] = centers[corner] + new Vector2(Mathf.Cos(angle), Mathf.Sin(angle)) * radius;
                }
            }
            return points;
        }
    }
}
