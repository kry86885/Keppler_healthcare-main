import { ensureRazorpayLoaded, openRazorpayCheckout } from "./razorpay";

describe("razorpay helper", () => {
  test("openRazorpayCheckout resolves with payment payload", async () => {
    const constructorSpy = vi.fn();
    class RazorpayMock {
      options: any;
      constructor(options: any) {
        constructorSpy(options);
        this.options = options;
      }
      open() {
        this.options.handler({
          razorpay_payment_id: "pay_test",
          razorpay_order_id: "order_test",
          razorpay_signature: "sig_test",
        });
      }
    }
    (window as any).Razorpay = RazorpayMock;

    const result = await openRazorpayCheckout({
      key: "rzp_test",
      amount: 1000,
      currency: "INR",
      name: "HospAI",
      description: "Test",
      order_id: "order_test",
    });

    expect(result.razorpay_payment_id).toBe("pay_test");
    expect(constructorSpy).toHaveBeenCalledTimes(1);
  });

  test("openRazorpayCheckout rejects on modal dismiss", async () => {
    class RazorpayMock {
      options: any;
      constructor(options: any) {
        this.options = options;
      }
      open() {
        this.options.modal.ondismiss();
      }
    }
    (window as any).Razorpay = RazorpayMock;

    await expect(
      openRazorpayCheckout({
        key: "rzp_test",
        amount: 1000,
        currency: "INR",
        name: "HospAI",
        description: "Dismiss",
        order_id: "order_dismiss",
      })
    ).rejects.toThrow("Razorpay checkout was closed.");
  });

  test("ensureRazorpayLoaded injects checkout script when absent", async () => {
    delete (window as any).Razorpay;
    const appendSpy = vi.spyOn(document.body, "appendChild");
    const originalCreateElement = document.createElement.bind(document);
    const scriptNodes: HTMLScriptElement[] = [];

    const createElementSpy = vi.spyOn(document, "createElement").mockImplementation(((tagName: string) => {
      const node = originalCreateElement(tagName);
      if (tagName.toLowerCase() === "script") {
        scriptNodes.push(node as HTMLScriptElement);
      }
      return node;
    }) as any);

    const loading = ensureRazorpayLoaded();
    expect(appendSpy).toHaveBeenCalled();
    expect(scriptNodes.length).toBeGreaterThan(0);
    scriptNodes[0].onload?.(new Event("load"));
    await loading;

    appendSpy.mockRestore();
    createElementSpy.mockRestore();
  });
});
