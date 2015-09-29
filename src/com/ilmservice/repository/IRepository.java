package com.ilmservice.repository;

import java.io.IOException;
import java.util.List;
import java.util.function.Function;
import java.util.function.Predicate;


public interface IRepository<V> {
	
	@FunctionalInterface
	public interface ParseFunction<T, R> {
	    R apply(T t) throws IOException;
	}
	
	@FunctionalInterface
	public interface Void {
	    void apply();
	}
	
	/**
	 * @param parser a function that returns an instance of <V> given a byte array.
	 * <pre>
	 * tests.configure( 
	 * 	(x) -> Event.parseFrom(x)
	 * );
	 * </pre>
	 */
	public void configure(
			ParseFunction<byte[], V> parser, 
			Function<V, byte[]> serializer,
			Void configureIndexes
	);
	
	/**
	 * creates an index for this repository with the key type of your choice.
	 * 
	 * @param name 
	 * @param defaultSupplier a function that returns the default instance of <V>. 
	 * 		  if a <K> key is provided, the function should set the key value on the <V>.
	 * @param getKeyFromValue a function that returns the <K> key given the <V> value.
	 * @param getKeyBytesFromKey a function that translates a <K> key to a byte array for storage.
	 * 
	 * <pre>
	 * transactionRepository.configureIndex(
	 * 	"id",
	 * 	(k) -> Transaction.newBuilder().setTransactionId(k).build(),
	 * 	(v) -> v.getTransactionId(),
	 * 	(k) -> ByteBuffer.allocate(4).putInt(k).array()
	 * );
	 * </pre>
	 * @throws Exception 
	 */
	public <K> IRepositoryIndex<K, V> configureIndex(
		short index,
		Function<K, V> defaultSupplier,
		Function<V, K> getKeyFromValue, 
		Function <K, byte[]> getKeyBytesFromKey
	) throws Exception;
	public V put(V value);
	public void delete(V value);

	
	public interface IRepositoryIndex<K, V> {
		public short getId();
		public IRepositoryQuery<K, V> query();
		public V getDefault(K keyOrNull);
		public V parse(byte[] data) throws IOException;
		public K getKeyFrom(V value);
		public byte[] getKeyBytesFromKey(K key);
		public byte[] getKeyBytesFromValue(V value);
	}
	
	public interface IRepositoryQuery<K, V> {
		public IRepositoryQuery<K, V> descending();
		public IRepositoryQuery<K, V> range(K start, K end);
		public IRepositoryQuery<K, V> atKey (K key);
		public IRepositoryQuery<K, V> where (Predicate<V> predicate);
		public IRepositoryQuery<K, V> limit(int n);
		public V firstOrDefault() throws IOException;
		public V firstOrNull() throws IOException;
		public List<V> toArray();
	}

	
}
