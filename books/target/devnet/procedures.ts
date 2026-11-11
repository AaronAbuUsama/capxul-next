// Devnet's door: the procedures other concepts invoke. There are none, by design. No concept depends
// on devnet (it sits at the top of the map), so no transaction of another concept may write a devnet
// table; the integrations' devnet fakes read and write these tables from their own layers, which a
// staging build does not contain (decision devnet.no-procedures-no-processes).

export {};
