package com.ilmservice.repository;

import java.io.IOException;

@FunctionalInterface
public interface ParseFunction<T, R> {
    R apply(T t) throws IOException;
}
