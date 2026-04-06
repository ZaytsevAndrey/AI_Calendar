const namespaces: string[] = [];

export default function createNamespacedAction(namespace: string) {
    const namespacedActions: string[] = [];

    if (namespaces.includes(namespace)) {
        throw new Error('not unique namespace name');
    }

    namespaces.push(namespace);

    return function createAction(action: string): string {
        const namespacedAction = `${ namespace }_${ action }`;
        if (namespacedActions.includes(namespacedAction)) {
            throw new Error(`not unique action: ${ namespacedAction }`);
        }

        namespacedActions.push(namespacedAction);
        return namespacedAction;
    };
}
