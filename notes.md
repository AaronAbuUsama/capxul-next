
bash scripts for something that is core is a bad smell. the cli should be the nexus of all things needed to do with everything. 

[| How a stage gets its hub | `./run.sh hub up [--hub <stage>] --owner <op> --lifetime "7 days"`, once; again on a live hub moves its expiry and changes nothing else. Every world made with `WORLD_HUB=<stage>` (default `fleet`) lives on it. `hub show` prints its owner, expiry, door and ledger; `hub down` is refused while a world names it or its ledger holds one. |](https://github.com/AaronAbuUsama/capxul-next/blob/f833895514b17bbda0f8ec229d7316ab38caf7f9/packages/world/README.md#L19-L20)

second thing these words i dont like 

door: i dont even know what it is
core: it should be named what it is. the rest of the concepts similiar should be called things that make sense together

third
the cli should be more purposefull. this is the actual door (dont use that word) to the application. its the surface that everything else is moddled on. everythnig you need to do with capxul should be assessable through this cli. every command should have a logical consistent style. that means ALL frappe things need a cli access. all apps all funcitons. you should also get programatic access to the safe within your authority but again this needs a proper design. somethign that everything else falls out of even things we have not thought of yet

forth 

i really want to design the names of everything all together. 
hub, door, core, world, ect