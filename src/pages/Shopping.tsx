import { Eraser, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { AISLE_ORDER } from "../../shared/ingredients";
import type { ShoppingItem } from "../../shared/types";
import { Menu } from "../components/ui";
import { api } from "../lib/api";
import { useQuery } from "../lib/hooks";
import { Link } from "../lib/router";
import { toast } from "../lib/stores";

/** "2 lb ground beef" -> { name: "ground beef", amount: "2 lb" } */
function splitAmount(text: string): { name: string; amount?: string } {
  const m = text.trim().match(/^([\d½¼¾⅓⅔/.\s-]+(?:\s*(?:lbs?|oz|g|kg|cups?|tbsp|tsp|cans?|packages?|bunch(?:es)?|dozen|bags?|boxes?|jars?|bottles?))?)\s+(.+)$/i);
  return m ? { amount: m[1]!.trim(), name: m[2]!.trim() } : { name: text.trim() };
}

export function Shopping() {
  const { data, error, mutate } = useQuery("/api/shopping", api.shopping);
  const [text, setText] = useState("");

  const items = data ?? [];
  const open = items.filter((i) => !i.checked);
  const done = items.filter((i) => i.checked);

  const add = async () => {
    const lines = text.split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
    if (!lines.length) return;
    setText("");
    try {
      mutate(await api.addShopping(lines.map(splitAmount)));
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  const toggle = async (item: ShoppingItem) => {
    mutate(items.map((i) => (i.id === item.id ? { ...i, checked: !i.checked } : i)));
    try {
      await api.updateShopping(item.id, { checked: !item.checked });
    } catch (e) {
      mutate(items);
      toast((e as Error).message, "error");
    }
  };

  const remove = async (item: ShoppingItem) => {
    mutate(items.filter((i) => i.id !== item.id));
    try {
      await api.deleteShopping(item.id);
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  const clear = async (checkedOnly: boolean) => {
    if (!checkedOnly && !confirm("Clear the whole shopping list?")) return;
    try {
      mutate(await api.clearShopping(checkedOnly));
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  const groups = AISLE_ORDER.map((aisle) => ({ aisle, items: open.filter((i) => i.aisle === aisle) })).filter((g) => g.items.length);
  const other = open.filter((i) => !AISLE_ORDER.includes(i.aisle));
  if (other.length) groups.push({ aisle: "Other", items: other });

  const Row = ({ item }: { item: ShoppingItem }) => (
    <li className={item.checked ? "checked" : ""}>
      <label>
        <input type="checkbox" checked={item.checked} onChange={() => toggle(item)} />
        <span className="grow">
          {item.amount ? <span className="amount">{item.amount}</span> : null}
          <span className="name">{item.name}</span>
          {item.recipes ? <span className="from">{item.recipes}</span> : null}
        </span>
      </label>
      <button className="icon-btn" onClick={() => remove(item)} aria-label={`Remove ${item.name}`}>
        <Trash2 size={18} />
      </button>
    </li>
  );

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Shopping</h1>
          <div className="page-sub">{data ? (open.length ? `${open.length} to get` : "All set") : " "}</div>
        </div>
        {items.length ? (
          <Menu
            trigger={(o) => (
              <button className="btn" onClick={o} aria-haspopup="menu">
                <Eraser size={19} /> Clear
              </button>
            )}
          >
            {(close) => (
              <>
                <button role="menuitem" onClick={() => (close(), void clear(true))} disabled={!done.length}>
                  Clear checked items ({done.length})
                </button>
                <button role="menuitem" className="danger" onClick={() => (close(), void clear(false))}>
                  Clear everything
                </button>
              </>
            )}
          </Menu>
        ) : null}
      </div>

      <form
        className="shop-add"
        onSubmit={(e) => {
          e.preventDefault();
          void add();
        }}
      >
        <input className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder="Add items, like 2 lb crawfish, lemons" aria-label="Add items" />
        <button className="btn primary" type="submit" aria-label="Add" style={{ width: 52, padding: 0, flex: "none" }}>
          <Plus size={22} />
        </button>
      </form>

      {error && !data ? <div className="error-box">{error.message}</div> : null}
      {!data && !error ? <div className="spinner" /> : null}

      {data && !items.length ? (
        <div className="empty">
          <h2>The list is empty</h2>
          <p>Add items above, or plan some meals and build the list from your week.</p>
          <Link to="/plan" className="btn">
            Open the meal plan
          </Link>
        </div>
      ) : null}

      {groups.map((g) => (
        <section key={g.aisle} className="aisle">
          <h2>
            {g.aisle} <span className="muted">{g.items.length}</span>
          </h2>
          <ul className="shop-list">
            {g.items.map((i) => (
              <Row key={i.id} item={i} />
            ))}
          </ul>
        </section>
      ))}

      {done.length ? (
        <section className="aisle">
          <h2>
            In the cart <span className="muted">{done.length}</span>
          </h2>
          <ul className="shop-list">
            {done.map((i) => (
              <Row key={i.id} item={i} />
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}
