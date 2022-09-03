import {y} from 'asdf2'

wrap = \x -> when eq(x, 1) is False -> Ok(x); True -> Err('Is 1')

? = \(x, f) -> when x is Ok(v) -> f(v); Err(msg) -> Err(msg)

concatMap = \(lst, f) -> fold(map(lst, f), ++, [])

x = 4 + y
y = (
    z <-? | wrap(5)
    w <-? | wrap(3)
    Ok(z + w)
)