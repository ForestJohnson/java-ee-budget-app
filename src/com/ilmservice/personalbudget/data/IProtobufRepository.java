package com.ilmservice.personalbudget.data;

import java.util.List;
import java.util.function.Function;
import java.util.function.Predicate;


public interface IProtobufRepository<V extends com.google.protobuf.GeneratedMessage> {
	public void configure(
		Function<byte[], V> parser
	);
	public <K> IProtobufIndex<K, V> configureIndex(
		String name,
		Function<K, V> defaultSupplier,
		Function<V, K> getKeyFromValue, 
		Function <K, byte[]> getKeyBytesFromKey
	);
	public V put(V value);
	public void delete(V value);

	
	public interface IProtobufIndex<K, V extends com.google.protobuf.GeneratedMessage> {
		public IProtobufQuery<K, V> query();
		public V getDefault(K keyOrNull);
		public V parse(byte[] data);
		public K getKeyFrom(V value);
		public byte[] getKeyBytesFrom(K key);
		public byte[] getKeyBytesFrom(V value);
	}
	
	public interface IProtobufQuery<K, V extends com.google.protobuf.GeneratedMessage> {
		public IProtobufQuery<K, V> descending();
		public IProtobufQuery<K, V> range(K start, K end);
		public IProtobufQuery<K, V> atKey (K key);
		public IProtobufQuery<K, V> where (Predicate<V> predicate);
		public IProtobufQuery<K, V> limit(int n);
		public V firstOrDefault()  ;
		public V firstOrNull()  ;
		public List<V> toArray()  ;
	}
}
