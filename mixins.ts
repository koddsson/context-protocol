import { ObservableMap } from "./context-protocol.js";
import { createContext, ContextEvent, UnknownContext } from "./index.js";

interface CustomElement extends HTMLElement {
  new (...args: any[]): CustomElement;
  observedAttributes: string[];
  connectedCallback?(): void;
  attributeChangedCallback?(
    name: string,
    oldValue: string | null,
    newValue: string | null,
  ): void;
  disconnectedCallback?(): void;
  adoptedCallback?(): void;
}

export function ProviderMixin(Class: CustomElement) {
  return class extends Class {
    #dataStore = new ObservableMap();

    connectedCallback() {
      super.connectedCallback?.();

      for (const attribute in this.observedAttributes) {
        this.#dataStore.set(attribute, this.getAttribute(attribute));
      }

      this.addEventListener('context-request', this);
    }

    // Listen for changed attributes and update the data store accordingly
    attributeChangedCallback(name: string, oldValue: string, newValue: string) {
      super.attributeChangedCallback?.(name, oldValue, newValue);
      this.#dataStore.set(name, newValue);
    }

    disconnectedCallback(): void {
      this.#dataStore = new ObservableMap();
    }

    handleEvent(event: Event) {
      if (event.type === "context-request") {
        this.#handleContextRequest(event as ContextEvent<UnknownContext>);
      }
    }

    // We listen for a bubbled context request event and provide the event with the context requested.
    #handleContextRequest(
      event: ContextEvent<{ name: string; initialValue?: unknown }>,
    ) {
      const { name, initialValue } = event.context;
      const subscribe = event.subscribe;
      if (initialValue) {
        this.#dataStore.set(name, initialValue);
      }
      const data = this.#dataStore.get(name);
      if (data) {
        event.stopPropagation();

        let unsubscribe = () => undefined;

        if (subscribe) {
          unsubscribe = () => {
            data.subscribers.delete(event.callback);
          };
          data.subscribers.add(event.callback);
        }

        event.callback(data.value, unsubscribe);
      }
    }
  };
}

export function ConsumerMixin(Class: CustomElement) {
  return class extends Class {
    unsubscribes: Array<() => void> = [];
    contexts: Record<string, (data: unknown) => void> = {};

    connectedCallback() {
      super.connectedCallback?.();

      for (const [contextName, callback] of Object.entries(this.contexts)) {
        const context = createContext(contextName);

        // We dispatch a event with that context. The event will bubble up the tree until it
        // reaches a component that is able to provide that value to us.
        // The event has a callback for the the value.
        this.dispatchEvent(
          new ContextEvent(
            context,
            (data, unsubscribe) => {
              callback(data);
              if (unsubscribe) {
                this.unsubscribes.push(unsubscribe);
              }
            },
            // Always subscribe. Consumers can ignore updates if they'd like.
            true,
          ),
        );
      }
    }

    // Unsubscribe from all callbacks when disconnecting
    disconnectedCallback() {
      for (const unsubscribe of this.unsubscribes) {
        unsubscribe?.();
      }
      // Empty out the array in case this element is still stored in memory but just not connected
      // to the DOM.
      this.unsubscribes = [];
    }
  };
}